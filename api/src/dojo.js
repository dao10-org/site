// 道场管理：道场管理员在网站上修改道场介绍、管理成员、查看站内留言
//
// - 道场资料存在仓库 src/zh/dojos/<代号>.11tydata.json（Eleventy 的模板数据文件），
//   图片存在 src/assets/dojos/<代号>/。每次保存 = 一次提交（只触发一次网站重建）。
// - 保存前 AI 按两条底线审核文字，与投稿同一套规则。
// - 联系方式由道场自己决定：可以公开写出，也可以只开“站内留言”，不公开任何联系方式。
// - 站内留言不记录留言人的 IP 或账号，时间只记到日期，180 天后自动删除。
import { HttpError, json, requireUser, randomId, today } from "./index.js";
import { moderate, countStat } from "./submit.js";

const REPO = "dao10-org/site";
const BRANCH = "main";
const DOJO_DIR = "src/zh/dojos";
const IMG_DIR = "src/assets/dojos";
const DAILY_EDITS = 10; // 每次保存都会重建网站（Cloudflare 免费额度每月 500 次）
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CONTACTS = 20;
const MSG_PER_DAY = 50; // 每个道场每天最多收多少条留言（防刷）
const MSG_KEEP_DAYS = 180;

const dataPath = (slug) => `${DOJO_DIR}/${slug}.11tydata.json`;

// ---------------- 权限 ----------------
function checkSlug(v) {
  const s = String(v || "").trim();
  if (!/^[a-z0-9-]{2,40}$/.test(s)) throw new HttpError(400, "道场代号不对");
  return s;
}

async function requireDojoAdmin(request, env, slugIn) {
  const user = await requireUser(request, env);
  const slug = checkSlug(slugIn);
  const row = await env.DB.prepare("SELECT role FROM dojo_admins WHERE dojo_slug = ? AND user_id = ?").bind(slug, user.id).first();
  if (!row || row.role !== "admin") throw new HttpError(403, "只有本道场的管理员可以管理道场");
  return { user, slug };
}

// ---------------- 读取（管理页面打开时） ----------------
export async function getDojo(request, url, env) {
  const { slug } = await requireDojoAdmin(request, env, url.searchParams.get("slug"));
  const cur = await readProfile(env, slug);
  const { results: members } = await env.DB.prepare(
    "SELECT u.username, u.display_name AS displayName, d.role FROM dojo_admins d JOIN users u ON u.id = d.user_id WHERE d.dojo_slug = ? ORDER BY d.role, u.username"
  )
    .bind(slug)
    .all();
  const { results: messages } = await env.DB.prepare(
    "SELECT id, body, contact, created_at AS date, is_read AS isRead FROM dojo_messages WHERE dojo_slug = ? ORDER BY created_at DESC, rowid DESC LIMIT 200"
  )
    .bind(slug)
    .all();
  return json({ slug, profile: cur.profile, version: cur.sha, members, messages });
}

async function readProfile(env, slug) {
  if (!env.GITHUB_TOKEN) throw new HttpError(503, "道场管理功能还在开通中，请稍后再试");
  const f = await gh(env, "GET", `/contents/${encodeURI(dataPath(slug))}?ref=${BRANCH}`);
  if (!f) return { sha: null, profile: emptyProfile(slug) };
  const bytes = Uint8Array.from(atob(f.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  return { sha: f.sha, profile: { ...emptyProfile(slug), ...JSON.parse(new TextDecoder().decode(bytes)) } };
}

function emptyProfile(slug) {
  return { title: slug, subtitle: "", kind: "", location: "", joined: today(), summary: "", intro: "", website: "", logo: "", images: [], contacts: [], relay: false, tags: [] };
}

// ---------------- 保存道场资料 ----------------
export async function saveDojo(request, body, env) {
  const { slug } = await requireDojoAdmin(request, env, body.slug);
  const cur = await readProfile(env, slug);
  if ((body.version || null) !== cur.sha) {
    throw new HttpError(409, "道场资料刚被其他管理员改过。请刷新页面，在最新版本上修改");
  }

  // 每日编辑次数
  const meta = (await env.DB.prepare("SELECT * FROM dojo_meta WHERE slug = ?").bind(slug).first()) || {};
  const day = today();
  const used = meta.edit_day === day ? meta.edit_count : 0;
  if (used >= DAILY_EDITS) throw new HttpError(429, `每个道场每天最多保存 ${DAILY_EDITS} 次，请明天再改`);

  const p = body.profile || {};
  const uploads = body.uploads && typeof body.uploads === "object" ? body.uploads : {};
  const files = {}; // 仓库路径 → 内容（字符串 / 字节 / null = 删除）
  const oldImages = new Set([cur.profile.logo, ...(cur.profile.images || []).map((i) => i.src)].filter(Boolean));
  const kept = new Set();

  // 图片：已有的（必须是本道场原有的图片）或新上传的（new:编号）
  const resolveImage = (src) => {
    src = String(src || "");
    if (!src) return "";
    if (oldImages.has(src)) {
      kept.add(src);
      return src;
    }
    const m = src.match(/^new:([A-Za-z0-9_-]{1,40})$/);
    if (!m || !uploads[m[1]]) throw new HttpError(400, "图片不对，请重新上传");
    const { bytes, ext } = decodeImage(uploads[m[1]]);
    const name = `${randomId(9).replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toLowerCase() || "img"}.${ext}`;
    files[`${IMG_DIR}/${slug}/${name}`] = bytes;
    return `/assets/dojos/${slug}/${name}`;
  };

  const images = Array.isArray(p.images) ? p.images : [];
  if (images.length > MAX_IMAGES) throw new HttpError(400, `图片最多 ${MAX_IMAGES} 张`);
  const contacts = Array.isArray(p.contacts) ? p.contacts : [];
  if (contacts.length > MAX_CONTACTS) throw new HttpError(400, `联系方式最多 ${MAX_CONTACTS} 项`);

  const profile = {
    title: text(p.title, "名称", 1, 40),
    subtitle: text(p.subtitle, "副标题", 0, 120),
    kind: text(p.kind, "类型", 0, 12),
    location: text(p.location, "所在地", 0, 30),
    joined: cur.profile.joined || day, // 入驻日期不能改
    summary: text(p.summary, "一句话简介", 0, 160),
    intro: String(p.intro || "").replace(/\r\n/g, "\n").trim(),
    website: checkUrl(p.website, "网站"),
    logo: resolveImage(p.logo),
    images: images.map((im) => ({ src: resolveImage(im && im.src), caption: text(im && im.caption, "图片说明", 0, 100) })),
    contacts: contacts
      .map((c) => ({ label: text(c && c.label, "联系方式名称", 0, 20), value: text(c && c.value, "联系方式", 0, 300) }))
      .filter((c) => c.value),
    relay: !!p.relay,
    // 标签：道场自己选的“关注方向”。可选列表在网站 src/_data/dojoTags.json，这里只检查格式
    tags: [...new Set((Array.isArray(p.tags) ? p.tags : []).map((t) => text(t, "标签", 1, 10)))],
  };
  if (profile.tags.length > 6) throw new HttpError(400, "标签最多 6 个");
  if (profile.intro.length > 20000) throw new HttpError(400, "详细介绍不能超过 20000 字");
  for (const c of profile.contacts) if (/^(javascript|data|vbscript):/i.test(c.value)) throw new HttpError(400, "联系方式格式不对");

  // AI 审核（只看文字：名称、简介、介绍、联系方式、图片说明）
  const all = [
    profile.subtitle,
    `类型：${profile.kind}　所在地：${profile.location}　标签：${profile.tags.join("、")}`,
    profile.summary,
    profile.intro,
    profile.images.map((i) => i.caption).filter(Boolean).join("\n"),
    profile.contacts.map((c) => `${c.label}：${c.value}`).join("\n"),
    profile.website,
  ]
    .filter(Boolean)
    .join("\n\n");
  const verdict = await moderate(env, `道场介绍：${profile.title}`, all);
  await countStat(env, verdict.ok);
  await env.DB.prepare(
    `INSERT INTO dojo_meta (slug, edit_day, edit_count) VALUES (?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET edit_day = excluded.edit_day, edit_count = excluded.edit_count`
  )
    .bind(slug, day, used + 1)
    .run();
  if (!verdict.ok) return json({ status: "rejected", reason: verdict.reason });

  // 不再使用的图片一并删除
  for (const src of oldImages) if (!kept.has(src)) files[`src${src}`] = null;
  files[dataPath(slug)] = JSON.stringify(profile, null, 2) + "\n";
  const shas = await githubCommit(env, files, `道场资料更新：${slug}`);
  await env.DB.prepare("UPDATE dojo_meta SET relay = ? WHERE slug = ?").bind(profile.relay ? 1 : 0, slug).run();
  return json({ status: "saved", profile, version: shas[dataPath(slug)], url: `/zh/dojos/${slug}/` });
}

function text(v, name, min, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (s.length < min || s.length > max) throw new HttpError(400, min ? `${name}需要 ${min}–${max} 个字` : `${name}不能超过 ${max} 个字`);
  if (/[<>]/.test(s)) throw new HttpError(400, `${name}不能包含 < 或 >`);
  return s;
}

function checkUrl(v, name) {
  const s = String(v || "").trim();
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, `${name}格式不对，请写完整网址（以 https:// 开头）`);
  }
  if (!["http:", "https:"].includes(u.protocol) || s.length > 500) throw new HttpError(400, `${name}格式不对`);
  return u.href;
}

// 图片：只收 JPEG / PNG（页面会先在浏览器里缩小并重新编码），并去掉拍摄地点等元数据
function decodeImage(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, "图片只支持 JPG 或 PNG");
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(400, "图片太大（最大 2MB）");
  if (m[1] === "jpeg") {
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) throw new HttpError(400, "图片文件已损坏");
    return { bytes: stripJpeg(bytes), ext: "jpg" };
  }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => bytes[i] === b)) throw new HttpError(400, "图片文件已损坏");
  return { bytes: stripPng(bytes), ext: "png" };
}

// JPEG：删除 APP1–APP15（EXIF、GPS、XMP 等）和注释段，保留 APP0（JFIF）和图像数据
export function stripJpeg(b) {
  const out = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break; // 图像数据开始，后面原样保留
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.subarray(i, i + 2 + len);
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  out.push(b.subarray(i));
  return concat(out);
}

// PNG：只保留显示需要的数据块，删除文字、时间、EXIF 等
export function stripPng(b) {
  const keep = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "gAMA", "sRGB", "cHRM", "iCCP", "pHYs"]);
  const out = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length) throw new HttpError(400, "图片文件已损坏");
    if (keep.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return concat(out);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------------- 成员管理 ----------------
// action: member（设为成员）| admin（设为管理员）| remove（移出道场）
export async function setMember(request, body, env) {
  const { user, slug } = await requireDojoAdmin(request, env, body.slug);
  const username = String(body.username || "").trim().toLowerCase();
  const action = String(body.action || "");
  if (!["member", "admin", "remove"].includes(action)) throw new HttpError(400, "操作不对");
  const target = await env.DB.prepare("SELECT id, display_name FROM users WHERE username = ?").bind(username).first();
  if (!target) throw new HttpError(404, "没有这个用户名。请对方先在本站注册，再把用户名告诉你");

  const cur = await env.DB.prepare("SELECT role FROM dojo_admins WHERE dojo_slug = ? AND user_id = ?").bind(slug, target.id).first();
  // 道场至少要留一位管理员
  if (cur?.role === "admin" && action !== "admin") {
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM dojo_admins WHERE dojo_slug = ? AND role = 'admin'").bind(slug).first();
    if (n <= 1) throw new HttpError(400, "道场至少要有一位管理员。请先把另一位成员设为管理员");
  }
  if (action === "remove") {
    if (!cur) throw new HttpError(404, "此人不在本道场");
    await env.DB.prepare("DELETE FROM dojo_admins WHERE dojo_slug = ? AND user_id = ?").bind(slug, target.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO dojo_admins (dojo_slug, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(dojo_slug, user_id) DO UPDATE SET role = excluded.role`
    )
      .bind(slug, target.id, action)
      .run();
  }
  return json({ ok: true, self: target.id === user.id });
}

// ---------------- 站内留言 ----------------
// 任何人（不需要登录）都可以给开启了留言的道场留言
export async function postMessage(body, env) {
  const slug = checkSlug(body.slug);
  const meta = await env.DB.prepare("SELECT relay FROM dojo_meta WHERE slug = ?").bind(slug).first();
  if (!meta || !meta.relay) throw new HttpError(404, "这个道场没有开启站内留言");
  const msg = String(body.body || "").replace(/\r\n/g, "\n").trim();
  const contact = String(body.contact || "").replace(/\s+/g, " ").trim();
  if (msg.length < 2 || msg.length > 3000) throw new HttpError(400, "留言需要 2–3000 字");
  if (contact.length > 200) throw new HttpError(400, "回复方式不能超过 200 字");
  const day = today();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM dojo_messages WHERE dojo_slug = ? AND created_at = ?").bind(slug, day).first();
  if (n >= MSG_PER_DAY) throw new HttpError(429, "这个道场今天收到的留言太多了，请明天再试");
  await env.DB.prepare("INSERT INTO dojo_messages (id, dojo_slug, body, contact, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(randomId(12), slug, msg, contact || null, day)
    .run();
  return json({ ok: true });
}

// 管理员：标记已读 / 删除留言
export async function messageAction(request, body, env) {
  const { slug } = await requireDojoAdmin(request, env, body.slug);
  const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(String).slice(0, 200);
  const sql =
    body.action === "delete"
      ? "DELETE FROM dojo_messages WHERE dojo_slug = ? AND id = ?"
      : "UPDATE dojo_messages SET is_read = 1 WHERE dojo_slug = ? AND id = ?";
  for (const id of ids) await env.DB.prepare(sql).bind(slug, id).run();
  return json({ ok: true });
}

// 定时任务：删除 180 天前的留言
export async function purgeOldMessages(env) {
  const cutoff = new Date(Date.now() - MSG_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM dojo_messages WHERE created_at < ?").bind(cutoff).run();
}

// ---------------- GitHub ----------------
async function gh(env, method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "dao10-bot",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "GET" && res.status === 404) return null;
  if (!res.ok) {
    const err = new HttpError(502, "保存失败，请稍后再试");
    err.ghStatus = res.status;
    console.error("GitHub", method, path, res.status, await res.text());
    throw err;
  }
  return res.json();
}

const BOT = { name: "dao10-bot", email: "bot@dao10.org" };

function toB64(content) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// 多个文件合成一次提交（只触发一次网站重建）。返回 路径 → 新文件 sha
export async function githubCommit(env, files, message) {
  const blobs = {};
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    blobs[path] = (await gh(env, "POST", "/git/blobs", { content: toB64(content), encoding: "base64" })).sha;
  }
  for (let attempt = 0; ; attempt++) {
    const ref = await gh(env, "GET", `/git/ref/heads/${BRANCH}`);
    const parent = ref.object.sha;
    const base = (await gh(env, "GET", `/git/commits/${parent}`)).tree.sha;
    const tree = Object.keys(files).map((path) => ({ path, mode: "100644", type: "blob", sha: files[path] === null ? null : blobs[path] }));
    const newTree = await gh(env, "POST", "/git/trees", { base_tree: base, tree });
    const commit = await gh(env, "POST", "/git/commits", { message, tree: newTree.sha, parents: [parent], author: BOT, committer: BOT });
    try {
      await gh(env, "PATCH", `/git/refs/heads/${BRANCH}`, { sha: commit.sha });
      return blobs;
    } catch (e) {
      // 同时有别的提交（例如有人投稿）：在最新版本上重做一次
      if (e.ghStatus === 422 && attempt < 2) continue;
      throw e;
    }
  }
}
