// 本地测试：用 Node 自带的 SQLite 模拟 Cloudflare D1，不需要启动 Cloudflare 模拟器。
// 运行：node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(new URL("../migrations/0001_accounts.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (list) => { db.exec("BEGIN"); try { for (const s of list) await s.run(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } },
    raw: db,
  };
}

const ORIGIN = "https://dao10.org";
function client(env) {
  let cookie = "";
  return async (path, body, { origin = ORIGIN, method } = {}) => {
    const init = { method: method || (body ? "POST" : "GET"), headers: { Cookie: cookie } };
    if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    if (origin) init.headers.Origin = origin;
    const res = await worker.fetch(new Request(ORIGIN + path, init), env);
    const set = res.headers.get("Set-Cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: res.status, data: await res.json(), setCookie: set };
  };
}

test("注册、登录、全站共用会话、退出", async () => {
  const env = { DB: makeD1() };
  const c = client(env);
  let r = await c("/api/register", { username: "QingFeng", password: "longpassword", displayName: "清风" });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, "qingfeng");
  assert.match(r.data.recoveryCode, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
  assert.match(r.setCookie, /HttpOnly; Secure; SameSite=Lax/);
  r = await c("/api/me");
  assert.equal(r.data.user.displayName, "清风");
  // 数据库里不存明文密码、不存明文令牌
  const row = env.DB.raw.prepare("SELECT * FROM users").get();
  assert.ok(row.pw_hash.startsWith("pbkdf2$") && !row.pw_hash.includes("longpassword"));
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}$/);
  r = await c("/api/logout", {});
  r = await c("/api/me");
  assert.equal(r.data.user, null);
  r = await c("/api/login", { username: "qingfeng", password: "wrongpass1" });
  assert.equal(r.status, 401);
  r = await c("/api/login", { username: "qingfeng", password: "longpassword" });
  assert.equal(r.status, 200);
});

test("用户名重复、格式校验", async () => {
  const env = { DB: makeD1() };
  const c = client(env);
  await c("/api/register", { username: "abc", password: "12345678" });
  assert.equal((await c("/api/register", { username: "ABC", password: "12345678" })).status, 409);
  assert.equal((await c("/api/register", { username: "a b", password: "12345678" })).status, 400);
  assert.equal((await c("/api/register", { username: "abcd", password: "short" })).status, 400);
  assert.equal((await c("/api/register", { username: "abcd", password: "12345678", displayName: "<script>" })).status, 400);
});

test("拒绝其他网站发起的请求（CSRF）", async () => {
  const env = { DB: makeD1() };
  const c = client(env);
  assert.equal((await c("/api/register", { username: "abc", password: "12345678" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await c("/api/register", { username: "abc", password: "12345678" }, { origin: null })).status, 403);
});

test("用恢复码找回：一次性，换发新码，旧会话下线", async () => {
  const env = { DB: makeD1() };
  const phone = client(env), laptop = client(env);
  const reg = await phone("/api/register", { username: "dao", password: "oldpassword" });
  const code = reg.data.recoveryCode;
  let r = await laptop("/api/recover", { username: "dao", recoveryCode: code.toLowerCase().replace(/-/g, " "), newPassword: "newpassword" });
  assert.equal(r.status, 200);
  assert.notEqual(r.data.recoveryCode, code);
  assert.equal((await phone("/api/me")).data.user, null, "旧设备应被下线");
  assert.equal((await laptop("/api/recover", { username: "dao", recoveryCode: code, newPassword: "another123" })).status, 401, "旧恢复码不能再用");
  assert.equal((await laptop("/api/login", { username: "dao", password: "newpassword" })).status, 200);
});

test("改显示名、改密码、注销账号即删除", async () => {
  const env = { DB: makeD1() };
  const c = client(env);
  await c("/api/register", { username: "me1", password: "password1" });
  assert.equal((await c("/api/profile", { displayName: "无名" })).data.user.displayName, "无名");
  assert.equal((await c("/api/password", { oldPassword: "bad", newPassword: "password2" })).status, 401);
  assert.equal((await c("/api/password", { oldPassword: "password1", newPassword: "password2" })).status, 200);
  assert.equal((await c("/api/me")).data.user.username, "me1", "改密码后本设备保持登录");
  assert.equal((await c("/api/delete-account", { password: "password2" })).status, 200);
  assert.equal(env.DB.raw.prepare("SELECT count(*) n FROM users").get().n, 0);
  assert.equal(env.DB.raw.prepare("SELECT count(*) n FROM sessions").get().n, 0);
});

test("道场管理员权限随账号返回", async () => {
  const env = { DB: makeD1() };
  const c = client(env);
  await c("/api/register", { username: "team", password: "password1" });
  const id = env.DB.raw.prepare("SELECT id FROM users").get().id;
  env.DB.raw.prepare("INSERT INTO dojo_admins VALUES ('gongdao-team', ?)").run(id);
  assert.deepEqual((await c("/api/me")).data.user.dojos, ["gongdao-team"]);
});

test("限频生效", async () => {
  let n = 0;
  const env = { DB: makeD1(), AUTH_LIMIT: { limit: async () => ({ success: ++n <= 2 }) } };
  const c = client(env);
  await c("/api/login", { username: "x", password: "y" });
  await c("/api/login", { username: "x", password: "y" });
  assert.equal((await c("/api/login", { username: "x", password: "y" })).status, 429);
});
