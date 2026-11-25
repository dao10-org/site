// 网页打开次数统计
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeD1, client } from "./helpers.mjs";
import worker from "../src/index.js";

const hit = (env, p, d, origin = "https://dao10.org") =>
  worker.fetch(new Request("https://dao10.org/api/hit", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ p, d }),
  }), env);

test("记录打开次数：只记日期、路径、次数；道场管理员看本道场，平台管理员看全站", async () => {
  const env = { DB: makeD1() };
  for (const p of ["/zh/dojos/yuan/", "/zh/dojos/yuan/", "/zh/dojos/yuan/about"]) assert.equal((await hit(env, p, "yuan")).status, 204);
  await hit(env, "/zh/", "");
  await hit(env, "/zh/library/a-post/", "yuan");            // 道场名下的文章也算本道场
  await hit(env, "/zh/<script>/", "");                       // 不合格的路径：不记
  await hit(env, "https://evil.example/", "");
  assert.equal((await hit(env, "/zh/", "", "https://evil.example")).status, 403, "别的网站不能刷");

  const rows = env.DB.raw.prepare("SELECT * FROM page_hits ORDER BY path").all();
  assert.deepEqual(rows.map((r) => [r.path, r.dojo, r.n]), [
    ["/zh/", "", 1], ["/zh/dojos/yuan/", "yuan", 2], ["/zh/dojos/yuan/about/", "yuan", 1], ["/zh/library/a-post/", "yuan", 1],
  ]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["day", "dojo", "n", "path"], "没有任何关于读者的字段");

  // 道场管理员：只能看自己的道场
  const a = client(env);
  await a("/api/register", { username: "master", password: "password1" });
  const id = env.DB.raw.prepare("SELECT id FROM users WHERE username = 'master'").get().id;
  env.DB.raw.prepare("INSERT INTO dojo_admins (dojo_slug, user_id, role) VALUES ('yuan', ?, 'admin')").run(id);
  let r = await a("/api/stats?slug=yuan");
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 4);
  assert.equal(r.data.pages[0].path, "/zh/dojos/yuan/");
  assert.equal((await a("/api/stats?slug=other")).status, 403);
  assert.equal((await a("/api/stats")).status, 403, "不是平台管理员不能看全站");

  // 平台管理员
  env.DB.raw.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(id);
  r = await a("/api/stats");
  assert.equal(r.data.total, 5);

  // 未登录
  assert.equal((await client(env)("/api/stats?slug=yuan")).status, 401);
});
