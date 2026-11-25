// 道场管理测试：AI 和 GitHub 都是假的
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeD1, client } from "./helpers.mjs";
import { stripJpeg, stripPng } from "../src/dojo.js";

// 假 GitHub：仓库 = 路径 → 字节；支持 contents GET 和 git data API（blobs/trees/commits/refs）
const repo = new Map();
const blobs = new Map();
let commits = 0;
let failNextRef = false;
const sha = (bytes) => "b" + Buffer.from(bytes).toString("hex").slice(0, 16) + bytes.length;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const p = u.pathname.replace("/repos/dao10-org/site", "");
  const body = init.body ? JSON.parse(init.body) : null;
  const ok = (x, s = 200) => new Response(JSON.stringify(x), { status: s });
  if (p.startsWith("/contents/")) {
    const path = decodeURI(p.slice(10));
    if (!repo.has(path)) return new Response("{}", { status: 404 });
    return ok({ sha: sha(repo.get(path)), content: Buffer.from(repo.get(path)).toString("base64") });
  }
  if (p === "/git/blobs") {
    const bytes = Buffer.from(body.content, "base64");
    blobs.set(sha(bytes), bytes);
    return ok({ sha: sha(bytes) }, 201);
  }
  if (p === "/git/ref/heads/main") return ok({ object: { sha: "c" + commits } });
  if (p.startsWith("/git/commits/")) return ok({ tree: { sha: "t" } });
  if (p === "/git/trees") {
    pendingTree = body.tree;
    return ok({ sha: "t2" }, 201);
  }
  if (p === "/git/commits") return ok({ sha: "c" + (commits + 1) }, 201);
  if (p === "/git/refs/heads/main") {
    if (failNextRef) { failNextRef = false; return new Response("{}", { status: 422 }); }
    for (const e of pendingTree) e.sha === null ? repo.delete(e.path) : repo.set(e.path, blobs.get(e.sha));
    commits++;
    return ok({});
  }
  throw new Error("未模拟的请求 " + p);
};
let pendingTree = [];

const AI = { run: async (m, { messages }) => ({
  response: messages[1].content.includes("驱逐") ? '{"decision":"reject","reason":"号召驱逐群体"}' : '{"decision":"publish","reason":"未违反"}',
}) };

const JPEG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 6, 0x45, 0x78, 0x69, 0x66, 0xff, 0xda, 1, 2, 3, 0xff, 0xd9]).toString("base64");

async function setup() {
  repo.clear(); blobs.clear(); commits = 0;
  const env = { DB: makeD1(), AI, GITHUB_TOKEN: "t" };
  const admin = client(env);
  await admin("/api/register", { username: "master", password: "password1", displayName: "道长" });
  const id = env.DB.raw.prepare("SELECT id FROM users WHERE username = 'master'").get().id;
  env.DB.raw.prepare("INSERT INTO dojo_admins (dojo_slug, user_id, role) VALUES ('yuan', ?, 'admin')").run(id);
  return { env, admin };
}

const PROFILE = {
  title: "圆道", subtitle: "", kind: "学派", location: "线上", summary: "一句话", intro: "## 我们是谁\n\n介绍。",
  website: "https://example.org", logo: "", images: [], contacts: [{ label: "微信视频号", value: "圆道讲堂" }, { label: "", value: "" }], relay: false,
};

test("管理员读取、保存道场资料（一次提交），上传图片并去掉元数据", async () => {
  const { admin } = await setup();
  let r = await admin("/api/dojo?slug=yuan");
  assert.equal(r.status, 200);
  assert.equal(r.data.version, null);
  assert.equal(r.data.members[0].username, "master");

  r = await admin("/api/dojo/save", {
    slug: "yuan", version: null,
    profile: { ...PROFILE, logo: "new:a", images: [{ src: "new:b", caption: "道场一角" }] },
    uploads: { a: JPEG, b: JPEG },
  });
  assert.equal(r.data.status, "saved", JSON.stringify(r.data));
  assert.equal(commits, 1, "资料和图片合成一次提交");
  const saved = JSON.parse(Buffer.from(repo.get("src/zh/dojos/yuan.11tydata.json")).toString());
  assert.equal(saved.title, "圆道");
  assert.equal(saved.contacts.length, 1, "空的联系方式被去掉");
  assert.match(saved.logo, /^\/assets\/dojos\/yuan\/[a-z0-9]+\.jpg$/);
  const img = repo.get("src" + saved.logo);
  assert.ok(!Buffer.from(img).includes(Buffer.from("Exif")), "EXIF 被删除");

  // 标签：可多选，重复的合并；太长、太多都拒绝
  r = await admin("/api/dojo/save", { slug: "yuan", version: r.data.version, profile: { ...r.data.profile, tags: ["人与人", "人与自然", "人与人"] } });
  assert.equal(r.data.status, "saved", JSON.stringify(r.data));
  assert.deepEqual(r.data.profile.tags, ["人与人", "人与自然"]);
  const v = r.data.version;
  r = await admin("/api/dojo/save", { slug: "yuan", version: v, profile: { ...r.data.profile, tags: ["这是一个超过十个字的很长的标签"] } });
  assert.equal(r.status, 400);
  r = await admin("/api/dojo/save", { slug: "yuan", version: v, profile: { ...PROFILE, tags: ["一", "二", "三", "四", "五", "六", "七"] } });
  assert.equal(r.status, 400);
  r = await admin("/api/dojo?slug=yuan");

  // 删除一张图片：同时从仓库删除文件
  r = await admin("/api/dojo/save", { slug: "yuan", version: r.data.version, profile: { ...r.data.profile, images: [] } });
  assert.equal(r.data.status, "saved");
  assert.ok(!repo.has("src" + saved.images[0].src));
  assert.ok(repo.has("src" + saved.logo));
});

test("版本冲突、不能引用别人的图片、入驻日期不能改、AI 拒绝", async () => {
  const { admin } = await setup();
  await admin("/api/dojo/save", { slug: "yuan", version: null, profile: PROFILE });
  assert.equal((await admin("/api/dojo/save", { slug: "yuan", version: null, profile: PROFILE })).status, 409);
  const { version, profile } = (await admin("/api/dojo?slug=yuan")).data;
  let r = await admin("/api/dojo/save", { slug: "yuan", version, profile: { ...profile, logo: "/assets/dojos/other/x.jpg" } });
  assert.equal(r.status, 400);
  r = await admin("/api/dojo/save", { slug: "yuan", version, profile: { ...profile, joined: "2000-01-01" } });
  assert.notEqual(r.data.profile.joined, "2000-01-01");
  const v2 = r.data.version;
  r = await admin("/api/dojo/save", { slug: "yuan", version: v2, profile: { ...profile, intro: "要把他们全部驱逐出去" } });
  assert.equal(r.data.status, "rejected");
  r = await admin("/api/dojo/save", { slug: "yuan", version: v2, profile: { ...profile, title: "<script>" } });
  assert.equal(r.status, 400);
});

test("提交时遇到别的提交，会在最新版本上重做", async () => {
  const { admin } = await setup();
  failNextRef = true;
  const r = await admin("/api/dojo/save", { slug: "yuan", version: null, profile: PROFILE });
  assert.equal(r.data.status, "saved");
  assert.ok(repo.has("src/zh/dojos/yuan.11tydata.json"));
});

test("非管理员不能管理；成员管理；至少保留一位管理员", async () => {
  const { env, admin } = await setup();
  const other = client(env);
  await other("/api/register", { username: "student", password: "password1", displayName: "学生" });
  assert.equal((await other("/api/dojo?slug=yuan")).status, 403);

  assert.equal((await admin("/api/dojo/member", { slug: "yuan", username: "nobody", action: "member" })).status, 404);
  assert.equal((await admin("/api/dojo/member", { slug: "yuan", username: "student", action: "member" })).status, 200);
  assert.deepEqual((await other("/api/me")).data.user.memberOf, ["yuan"]);
  assert.equal((await other("/api/dojo?slug=yuan")).status, 403, "成员不能管理");

  assert.equal((await admin("/api/dojo/member", { slug: "yuan", username: "master", action: "remove" })).status, 400, "唯一的管理员不能移出自己");
  await admin("/api/dojo/member", { slug: "yuan", username: "student", action: "admin" });
  assert.equal((await other("/api/dojo?slug=yuan")).status, 200);
  assert.equal((await other("/api/dojo/member", { slug: "yuan", username: "master", action: "remove" })).status, 200);
  assert.equal((await admin("/api/dojo?slug=yuan")).status, 403);
});

test("站内留言：开启后任何人可留言，不需登录；管理员可读、删", async () => {
  const { env, admin } = await setup();
  const reader = client(env);
  assert.equal((await reader("/api/dojo/message", { slug: "yuan", body: "你好，想请教" })).status, 404, "未开启");
  await admin("/api/dojo/save", { slug: "yuan", version: null, profile: { ...PROFILE, relay: true } });
  assert.equal((await reader("/api/dojo/message", { slug: "yuan", body: "你好，想请教", contact: "Telegram @abc" })).status, 200);
  const row = env.DB.raw.prepare("SELECT * FROM dojo_messages").get();
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(row).sort(), ["body", "contact", "created_at", "dojo_slug", "id", "is_read"], "不记录 IP 或账号");
  let r = await admin("/api/dojo?slug=yuan");
  assert.equal(r.data.messages.length, 1);
  await admin("/api/dojo/messages", { slug: "yuan", id: r.data.messages[0].id, action: "read" });
  assert.equal((await admin("/api/dojo?slug=yuan")).data.messages[0].isRead, 1);
  await admin("/api/dojo/messages", { slug: "yuan", id: r.data.messages[0].id, action: "delete" });
  assert.equal((await admin("/api/dojo?slug=yuan")).data.messages.length, 0);
});

test("图片元数据清理", () => {
  const j = stripJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xe1, 0, 4, 9, 9, 0xff, 0xfe, 0, 3, 7, 0xff, 0xda, 5, 6]));
  assert.deepEqual([...j], [0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xda, 5, 6]);
  const chunk = (type, data = []) => [0, 0, 0, data.length, ...Buffer.from(type), ...data, 0, 0, 0, 0];
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = Uint8Array.from([...sig, ...chunk("IHDR", [1]), ...chunk("tEXt", [65]), ...chunk("IDAT", [2]), ...chunk("IEND")]);
  assert.deepEqual([...stripPng(png)], [...sig, ...chunk("IHDR", [1]), ...chunk("IDAT", [2]), ...chunk("IEND")]);
});
