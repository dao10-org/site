// 投稿测试：AI 和 GitHub 都用假的，不会真的发布任何东西
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { renderPost } from "../src/submit.js";
import { makeD1, client } from "./helpers.mjs";

// 假 GitHub：把“提交”的文件记在内存里
const repo = new Map();
globalThis.fetch = async (url, init = {}) => {
  const path = decodeURI(new URL(url).pathname.split("/contents/")[1]);
  if (init.method === "PUT") {
    const b = JSON.parse(init.body);
    repo.set(path, new TextDecoder().decode(Uint8Array.from(atob(b.content), (c) => c.charCodeAt(0))));
    return new Response("{}", { status: 201 });
  }
  if (init.method === "DELETE") { repo.delete(path); return new Response("{}"); }
  if (!repo.has(path)) return new Response("{}", { status: 404 });
  return new Response(JSON.stringify({ sha: "x" }));
};

// 假 AI：正文含“驱逐”就拒绝
const AI = { run: async (model, { messages }) => ({
  response: messages[1].content.includes("驱逐")
    ? '{"decision":"reject","reason":"号召驱逐群体，违反共生"}'
    : '<think>想一想</think>{"decision":"publish","reason":"未违反"}',
}) };

function setup() {
  repo.clear();
  const env = { DB: makeD1(), AI, GITHUB_TOKEN: "test" };
  return { env, c: client(env) };
}
const BODY = "顺道而行，就是认识规律、尊重规律，然后采取合理的行动。这是一篇测试文章。";

test("署名个人投稿：审核通过立即发布，出现在“我的投稿”，可以撤回", async () => {
  const { env, c } = setup();
  await c("/api/register", { username: "writer", password: "password1", displayName: "清风" });
  const r = await c("/api/submit", { title: "顺道而行", body: BODY, agree: true });
  assert.equal(r.data.status, "published");
  assert.match(r.data.url, /^\/zh\/library\/\d{4}-\d{2}-\d{2}-[a-z0-9]+\/$/);
  const [path, file] = [...repo.entries()][0];
  assert.match(path, /^src\/zh\/posts\/.+\.md$/);
  assert.match(file, /author: "清风"/);
  assert.match(file, /anonymous: false/);
  assert.match(file, /templateEngineOverride: md/);
  assert.doesNotMatch(file, /^dojo:/m);
  const mine = await c("/api/my-submissions");
  assert.equal(mine.data.items.length, 1);
  assert.equal((await c("/api/withdraw", { id: mine.data.items[0].id })).status, 200);
  assert.equal(repo.size, 0);
});

test("违反底线被拒绝，不发布，计入统计", async () => {
  const { env, c } = setup();
  await c("/api/register", { username: "bad", password: "password1" });
  const r = await c("/api/submit", { title: "坏文章", body: "应该把某个群体全部驱逐出去，这是测试拒绝的句子。", agree: true });
  assert.equal(r.data.status, "rejected");
  assert.match(r.data.reason, /共生/);
  assert.equal(repo.size, 0);
  const s = await c("/api/moderation-stats");
  assert.equal(s.data.months[0].rejected, 1);
});

test("匿名投稿：不记录作者，定时发布，凭管理密钥撤回", async () => {
  const { env, c } = setup();
  await c("/api/register", { username: "anon", password: "password1", displayName: "真名" });
  const r = await c("/api/submit", { title: "匿名文章", body: BODY, anonymous: true, agree: true });
  assert.equal(r.data.status, "scheduled");
  assert.match(r.data.manageKey, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
  const row = env.DB.raw.prepare("SELECT * FROM submissions").get();
  assert.equal(row.user_id, null, "数据库不能记录匿名稿件的作者");
  assert.doesNotMatch(row.file, /真名/);
  assert.match(row.file, /anonymous: true/);
  assert.equal((await c("/api/my-submissions")).data.items.length, 0);
  assert.equal(repo.size, 0, "不能立即发布");
  // 时间到了才发布
  env.DB.raw.prepare("UPDATE submissions SET publish_at = 0").run();
  await worker.scheduled({}, env, { waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(repo.size, 1);
  assert.equal(env.DB.raw.prepare("SELECT file FROM submissions").get().file, null, "发布后清除暂存内容");
  assert.equal((await c("/api/withdraw-anon", { key: "wrong" })).status, 404);
  assert.equal((await c("/api/withdraw-anon", { key: r.data.manageKey.toLowerCase() })).status, 200);
  assert.equal(repo.size, 0);
});

test("只有道场成员能投到该道场", async () => {
  const { env, c } = setup();
  await c("/api/register", { username: "member", password: "password1" });
  assert.equal((await c("/api/submit", { title: "道场文章", body: BODY, dojo: "gongsheng", agree: true })).status, 403);
  const id = env.DB.raw.prepare("SELECT id FROM users").get().id;
  env.DB.raw.prepare("INSERT INTO dojo_admins (dojo_slug, user_id, role) VALUES ('gongsheng', ?, 'member')").run(id);
  const me = await c("/api/me");
  assert.deepEqual(me.data.user.memberOf, ["gongsheng"]);
  assert.deepEqual(me.data.user.dojos, [], "成员不是管理员");
  assert.equal((await c("/api/submit", { title: "道场文章", body: BODY, dojo: "gongsheng", agree: true })).data.status, "published");
  assert.match([...repo.values()][0], /dojo: "gongsheng"/);
});

test("未登录、未确认须知、每日额度", async () => {
  const { env, c } = setup();
  assert.equal((await c("/api/submit", { title: "标题", body: BODY, agree: true })).status, 401);
  await c("/api/register", { username: "q", password: "password1" }).catch(() => {});
  await c("/api/register", { username: "quota", password: "password1" });
  assert.equal((await c("/api/submit", { title: "标题", body: BODY })).status, 400);
  for (let i = 0; i < 5; i++) await c("/api/submit", { title: "标题" + i, body: BODY, agree: true });
  assert.equal((await c("/api/submit", { title: "第六篇", body: BODY, agree: true })).status, 429);
});

test("投稿内容不能注入 HTML 或模板代码", () => {
  const f = renderPost({ title: '标题"\n---\nevil: 1', text: "<script>alert(1)</script> {{ site.url }} {% raw %}", date: "2026-11-23", dojo: "", author: "某人", license: "CC BY-SA 4.0" });
  assert.doesNotMatch(f, /<script>/);
  assert.match(f, /&lt;script>/);
  assert.ok(f.includes("title: " + JSON.stringify('标题"\n---\nevil: 1')), "标题被安全转义在一行内");
  assert.equal(f.split("\n---\n").length, 2, "front matter 只能有一段");
});

test("未配置 GitHub 时提示功能开通中", async () => {
  const env = { DB: makeD1(), AI };
  const c = client(env);
  await c("/api/register", { username: "early", password: "password1" });
  assert.equal((await c("/api/submit", { title: "标题", body: BODY, agree: true })).status, 503);
});
