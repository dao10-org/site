// 本地测试：用 Node 自带的 SQLite 模拟 Cloudflare D1，不需要启动 Cloudflare 模拟器。
// 运行：node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeD1, client } from "./helpers.mjs";

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
  env.DB.raw.prepare("INSERT INTO dojo_admins (dojo_slug, user_id) VALUES ('gongdao-team', ?)").run(id);
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
