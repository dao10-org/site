// 共道文明 · 账号后台
// 主站和所有道场二级网站都在 dao10.org 同一个域名下，所以登录一次、全站通用（同一个 Cookie）。
//
// 隐私原则：
// - 不收集邮箱、手机号；不把 IP 写进数据库或日志（限频只在 Cloudflare 内存里计数）
// - 密码只存 PBKDF2 哈希；登录令牌和恢复码只存 SHA-256 哈希
// - 注册时间只记到日期
// - 用户可以随时自行注销，账号数据立即删除

const COOKIE = "gd_s";
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000; // Workers 允许的上限

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "服务器出错，请稍后再试" }, 500);
    }
  },
};

// ---------------- 路由 ----------------
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (method === "GET" && path === "/api/me") return me(request, env);
  if (method !== "POST") throw new HttpError(404, "没有这个接口");

  checkOrigin(request, env);
  const body = await readJson(request);

  switch (path) {
    case "/api/register":
      await limit(request, env, "register");
      return register(body, env);
    case "/api/login":
      await limit(request, env, "login");
      return login(body, env);
    case "/api/recover":
      await limit(request, env, "recover");
      return recover(body, env);
    case "/api/logout":
      return logout(request, env);
    case "/api/password":
      return changePassword(request, body, env);
    case "/api/profile":
      return updateProfile(request, body, env);
    case "/api/delete-account":
      return deleteAccount(request, body, env);
    default:
      throw new HttpError(404, "没有这个接口");
  }
}

// ---------------- 接口 ----------------
async function me(request, env) {
  const user = await currentUser(request, env);
  return json({ user: user ? await publicUser(user, env) : null });
}

async function register(body, env) {
  const username = checkUsername(body.username);
  const password = checkPassword(body.password);
  const displayName = checkDisplayName(body.displayName || body.username);

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first();
  if (exists) throw new HttpError(409, "这个用户名已经有人用了，请换一个");

  const id = randomId(16);
  const recoveryCode = newRecoveryCode();
  await env.DB.prepare(
    "INSERT INTO users (id, username, display_name, pw_hash, recovery_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'user', ?)"
  )
    .bind(id, username, displayName, await hashPassword(password), await sha256(normRecovery(recoveryCode)), today())
    .run();

  const cookie = await createSession(id, env);
  const user = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return json({ user: await publicUser(user, env), recoveryCode }, 200, cookie);
}

async function login(body, env) {
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  // 用户不存在时也计算一次哈希，避免靠响应时间猜出用户名是否存在
  const ok = user ? await verifyPassword(password, user.pw_hash) : (await hashPassword(password), false);
  if (!ok) throw new HttpError(401, "用户名或密码不对");
  const cookie = await createSession(user.id, env);
  return json({ user: await publicUser(user, env) }, 200, cookie);
}

async function recover(body, env) {
  const username = String(body.username || "").trim().toLowerCase();
  const code = normRecovery(body.recoveryCode);
  const password = checkPassword(body.newPassword);
  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  const ok = user && safeEqual(await sha256(code), user.recovery_hash);
  if (!ok) throw new HttpError(401, "用户名或恢复码不对");

  // 恢复码只能用一次：换新密码的同时发一个新恢复码，并让其他设备全部下线
  const newCode = newRecoveryCode();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_hash = ?, recovery_hash = ? WHERE id = ?").bind(
      await hashPassword(password),
      await sha256(normRecovery(newCode)),
      user.id
    ),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
  ]);
  const cookie = await createSession(user.id, env);
  return json({ user: await publicUser(user, env), recoveryCode: newCode }, 200, cookie);
}

async function logout(request, env) {
  const token = readCookie(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, clearCookie());
}

async function changePassword(request, body, env) {
  const user = await requireUser(request, env);
  if (!(await verifyPassword(String(body.oldPassword || ""), user.pw_hash))) throw new HttpError(401, "原密码不对");
  const password = checkPassword(body.newPassword);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pw_hash = ? WHERE id = ?").bind(await hashPassword(password), user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id), // 其他设备下线
  ]);
  const cookie = await createSession(user.id, env);
  return json({ ok: true }, 200, cookie);
}

async function updateProfile(request, body, env) {
  const user = await requireUser(request, env);
  const displayName = checkDisplayName(body.displayName);
  await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(displayName, user.id).run();
  return json({ user: await publicUser({ ...user, display_name: displayName }, env) });
}

async function deleteAccount(request, body, env) {
  const user = await requireUser(request, env);
  if (!(await verifyPassword(String(body.password || ""), user.pw_hash))) throw new HttpError(401, "密码不对");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM dojo_admins WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true }, 200, clearCookie());
}

// ---------------- 会话 ----------------
async function createSession(userId, env) {
  const token = randomId(32);
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.batch([
    // 顺手清理过期会话
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
      await sha256(token),
      userId,
      expires
    ),
  ]);
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : null;
}

async function currentUser(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  return env.DB.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  )
    .bind(await sha256(token), Math.floor(Date.now() / 1000))
    .first();
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "请先登录");
  return user;
}

async function publicUser(u, env) {
  const { results } = await env.DB.prepare("SELECT dojo_slug FROM dojo_admins WHERE user_id = ? ORDER BY dojo_slug")
    .bind(u.id)
    .all();
  return {
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    dojos: results.map((r) => r.dojo_slug), // 可以管理的道场
    since: u.created_at,
  };
}

// ---------------- 校验 ----------------
function checkUsername(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(s)) throw new HttpError(400, "用户名只能用 3–24 位英文小写字母、数字或下划线");
  return s;
}
function checkPassword(v) {
  const s = String(v || "");
  if (s.length < 8 || s.length > 200) throw new HttpError(400, "密码至少 8 位");
  return s;
}
function checkDisplayName(v) {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  if (s.length < 1 || s.length > 30) throw new HttpError(400, "显示名需要 1–30 个字");
  if (/[<>]/.test(s)) throw new HttpError(400, "显示名不能包含 < 或 >");
  return s;
}

// 只接受来自本站页面的提交，防止别的网站冒用已登录用户的身份（CSRF）
function checkOrigin(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "https://dao10.org").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin");
  if (!origin || !allowed.includes(origin)) throw new HttpError(403, "请从本站页面操作");
}

async function readJson(request) {
  const type = request.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "格式不对");
  const text = await request.text();
  if (text.length > 10000) throw new HttpError(413, "内容太长");
  try {
    const v = JSON.parse(text || "{}");
    if (typeof v !== "object" || v === null) throw 0;
    return v;
  } catch {
    throw new HttpError(400, "格式不对");
  }
}

async function limit(request, env, action) {
  if (!env.AUTH_LIMIT) return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.AUTH_LIMIT.limit({ key: `${action}:${ip}` });
  if (!success) throw new HttpError(429, "操作太频繁，请一分钟后再试");
}

// ---------------- 加密工具（全部用 Web Crypto，无第三方依赖） ----------------
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}

async function verifyPassword(password, stored) {
  const [, , salt] = String(stored).split("$");
  if (!salt) return false;
  return safeEqual(await hashPassword(password, salt), stored);
}

async function sha256(s) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));
}

function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function randomId(bytes) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 恢复码：20 位，去掉容易看错的字符，分 4 组显示，例如 7KQ2M-XW9PD-HR3TN-B6FJA
function newRecoveryCode() {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(20));
  const s = Array.from(r, (x) => abc[x % abc.length]).join("");
  return s.match(/.{5}/g).join("-");
}
const normRecovery = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const today = () => new Date().toISOString().slice(0, 10);

// ---------------- 响应 ----------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, cookie) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(data), { status, headers });
}
