// 共道推荐测试：AI 和 GitHub 都是假的
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeD1, client } from "./helpers.mjs";
import { normLink } from "../src/recommend.js";

const repo = new Map();
const blobs = new Map();
let commits = 0;
let pendingTree = [];
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
  if (p === "/git/trees") { pendingTree = body.tree; return ok({ sha: "t2" }, 201); }
  if (p === "/git/commits") return ok({ sha: "c" + (commits + 1) }, 201);
  if (p === "/git/refs/heads/main") {
    for (const e of pendingTree) e.sha === null ? repo.delete(e.path) : repo.set(e.path, blobs.get(e.sha));
    commits++;
    return ok({});
  }
  throw new Error("未模拟的请求 " + p);
};

const AI = { run: async (m, { messages }) => ({
  response: messages[1].content.includes("驱逐") ? '{"decision":"reject","reason":"号召驱逐群体"}' : '{"decision":"publish","reason":"未违反"}',
}) };
const JPEG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 6, 0x45, 0x78, 0x69, 0x66, 0xff, 0xda, 1, 2, 3, 0xff, 0xd9]).toString("base64");

async function setup() {
  repo.clear(); blobs.clear(); commits = 0;
  const env = { DB: makeD1(), AI, GITHUB_TOKEN: "t" };
  const a = client(env), b = client(env), boss = client(env);
  await a("/api/register", { username: "alice", password: "password1", displayName: "甲" });
  await b("/api/register", { username: "bob", password: "password1", displayName: "乙" });
  await boss("/api/register", { username: "boss", password: "password1", displayName: "平台" });
  env.DB.raw.prepare("UPDATE users SET role = 'admin' WHERE username = 'boss'").run();
  return { env, a, b, boss };
}

const REC = { name: "清风讲堂", platform: "YouTube", link: "https://www.youtube.com/@qingfeng?si=abc", intro: "每周讲一段《道德经》的现代理解。", tags: ["人与自然"], agree: true };
const entry = (id) => JSON.parse(Buffer.from(repo.get(`src/_recommends/${id}.json`)).toString());

test("链接规范化：忽略 www、结尾斜杠、追踪参数", () => {
  assert.equal(normLink("https://www.youtube.com/@QingFeng/?si=x"), normLink("http://youtube.com/@qingfeng"));
  assert.notEqual(normLink("https://youtube.com/watch?v=aaa"), normLink("https://youtube.com/watch?v=bbb"));
});

test("登录才能推荐；收录、图片去元数据、重复推荐、只有账号名也可以", async () => {
  const { env, a, b } = await setup();
  const guest = client(env);
  assert.equal((await guest("/api/recommend", REC)).status, 401);

  let r = await a("/api/recommend", { ...REC, image: JPEG });
  assert.equal(r.data.status, "listed", JSON.stringify(r.data));
  assert.equal(commits, 1, "条目和图片一次提交");
  const e = entry(r.data.id);
  assert.equal(e.by, "甲");
  assert.equal(e.status, "listed");
  assert.match(e.image, /^\/assets\/recommends\/[a-z0-9]+\.jpg$/);
  assert.ok(!Buffer.from(repo.get("src" + e.image)).includes(Buffer.from("Exif")));

  r = await b("/api/recommend", { ...REC, name: "别的名字", link: "https://youtube.com/@QINGFENG/" });
  assert.equal(r.data.status, "duplicate");
  assert.equal(commits, 1);

  // 视频号：没有网址，只写账号名；可以不署名
  r = await b("/api/recommend", { name: "圆道讲堂", platform: "微信视频号", account: "圆道讲堂", intro: "讲修心与日常生活的短视频。", hideName: true, agree: true });
  assert.equal(r.data.status, "listed", JSON.stringify(r.data));
  assert.equal(entry(r.data.id).by, "");
  r = await a("/api/recommend", { name: "圆道 讲堂", platform: "微信视频号", account: "x", intro: "同一个视频号再推荐一次。", agree: true });
  assert.equal(r.data.status, "duplicate");

  // 链接和账号都没有、介绍太短、带 <、没勾须知
  assert.equal((await a("/api/recommend", { ...REC, link: "", account: "" })).status, 400);
  assert.equal((await a("/api/recommend", { ...REC, link: "https://a.org", intro: "短" })).status, 400);
  assert.equal((await a("/api/recommend", { ...REC, link: "https://a.org", name: "<b>" })).status, 400);
  assert.equal((await a("/api/recommend", { ...REC, link: "https://a.org", agree: false })).status, 400);
  assert.equal((await a("/api/recommend", { ...REC, link: "javascript:alert(1)" })).status, 400);
});

test("AI 拒绝不收录；每日额度", async () => {
  const { a } = await setup();
  let r = await a("/api/recommend", { ...REC, intro: "这个频道号召把他们驱逐出去" });
  assert.equal(r.data.status, "rejected");
  assert.equal(commits, 0);
  for (let i = 0; i < 5; i++) {
    r = await a("/api/recommend", { ...REC, link: `https://site${i}.org`, name: "站" + i });
    assert.equal(r.data.status, "listed");
  }
  assert.equal((await a("/api/recommend", { ...REC, link: "https://site9.org", name: "站9" })).status, 429);
});

test("撤回、移除（对方要求）、已邀请、已入驻", async () => {
  const { a, b, boss } = await setup();
  const id = (await a("/api/recommend", { ...REC, image: JPEG })).data.id;
  const img = entry(id).image;

  // 别人不能撤回
  assert.equal((await b("/api/recommend/action", { id, action: "withdraw" })).status, 403);
  assert.equal((await a("/api/recommend/action", { id, action: "invite" })).status, 403);
  // 我的推荐
  assert.equal((await a("/api/recommend/mine")).data.items.length, 1);
  assert.equal((await b("/api/recommend/mine")).data.items.length, 0);

  // 平台管理员：已邀请（不写进仓库）、已入驻（写进仓库）
  const before = commits;
  assert.equal((await boss("/api/recommend/action", { id, action: "invite" })).data.ok, true);
  assert.equal(commits, before);
  let m = await boss("/api/recommend/mine");
  assert.equal(m.data.admin, true);
  assert.equal(m.data.items[0].invited, 1);
  assert.equal((await boss("/api/recommend/action", { id, action: "join", dojo: "Bad Slug" })).status, 400);
  assert.equal((await boss("/api/recommend/action", { id, action: "join", dojo: "qingfeng" })).data.ok, true);
  assert.equal(entry(id).status, "joined");
  assert.equal(entry(id).dojo, "qingfeng");

  // 推荐人撤回：文件和图片都删除，之后可以再推荐
  assert.equal((await a("/api/recommend/action", { id, action: "withdraw" })).data.ok, true);
  assert.ok(!repo.has(`src/_recommends/${id}.json`));
  assert.ok(!repo.has("src" + img));
  assert.equal((await b("/api/recommend", REC)).data.status, "listed");

  // 对方要求不收录：移除后不能再推荐；解除后可以
  const id2 = (await b("/api/recommend/mine")).data.items[0].id;
  assert.equal((await boss("/api/recommend/action", { id: id2, action: "block" })).data.ok, true);
  assert.ok(!repo.has(`src/_recommends/${id2}.json`));
  assert.equal((await a("/api/recommend", REC)).status, 409);
  assert.equal((await boss("/api/recommend/action", { id: id2, action: "unblock" })).data.ok, true);
  assert.equal((await a("/api/recommend", REC)).data.status, "listed");
});

test("注销账号后，推荐条目保留", async () => {
  const { env, a } = await setup();
  const id = (await a("/api/recommend", REC)).data.id;
  await a("/api/delete-account", { password: "password1" });
  assert.equal(env.DB.raw.prepare("SELECT user_id FROM recommends WHERE id = ?").get(id).user_id, null);
  assert.ok(repo.has(`src/_recommends/${id}.json`));
});
