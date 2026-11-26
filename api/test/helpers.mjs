// 测试工具：用 Node 自带的 SQLite 模拟 Cloudflare D1
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

export function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of ["0001_accounts.sql", "0002_submissions.sql", "0003_purge.sql", "0004_dojo.sql", "0005_hits.sql", "0006_recommend.sql"])
    db.exec(readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"));
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
export function client(env) {
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

