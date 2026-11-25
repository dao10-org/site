// 网页打开次数统计
// - 只记“哪一天、哪一页、几次”，不记 IP、不用 Cookie、不记设备，不统计人数
// - 每个道场的管理员只能看到自己道场的数字；平台管理员（users.role = 'admin'）能看到全站
// - 数字不公开显示（避免道场之间互相比较、变成排行榜）
import { HttpError, json, today, requireUser } from "./index.js";

const PATH_RE = /^\/(?:(?:zh|en)\/(?:[A-Za-z0-9._~-]+\/)*)?$/;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const KEEP_DAYS = 400;

// 读者打开网页时，网页悄悄发来一次 { p: 路径, d: 道场代号 }
export async function hit(request, body, env) {
  let p = String(body.p || "");
  if (p && !p.endsWith("/")) p += "/";
  const d = String(body.d || "");
  if (p.length > 200 || !PATH_RE.test(p)) return new Response(null, { status: 204 });
  // 限频只在 Cloudflare 内存里按 IP 计数，不写进数据库（防止有人刷数字）
  if (env.AUTH_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.AUTH_LIMIT.limit({ key: `hit:${ip}` });
    if (!success) return new Response(null, { status: 204 });
  }
  await env.DB.prepare(
    `INSERT INTO page_hits (day, path, dojo, n) VALUES (?, ?, ?, 1)
     ON CONFLICT(day, path) DO UPDATE SET n = n + 1, dojo = excluded.dojo`
  )
    .bind(today(), p, SLUG_RE.test(d) ? d : "")
    .run();
  return new Response(null, { status: 204 });
}

// 查看统计：?slug=<道场> 看本道场（需是该道场管理员）；不带 slug 看全站（需是平台管理员）
export async function getStats(request, url, env) {
  const user = await requireUser(request, env);
  const slug = url.searchParams.get("slug") || "";
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days"), 10) || 30, 1), 365);
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  let where, args;
  if (slug) {
    if (!SLUG_RE.test(slug)) throw new HttpError(400, "道场代号不对");
    const row = await env.DB.prepare("SELECT role FROM dojo_admins WHERE dojo_slug = ? AND user_id = ?").bind(slug, user.id).first();
    if (!row && user.role !== "admin") throw new HttpError(403, "只有本道场的成员可以查看本道场的统计");
    where = "dojo = ? AND day >= ?";
    args = [slug, since];
  } else {
    if (user.role !== "admin") throw new HttpError(403, "只有平台管理员可以查看全站统计");
    where = "day >= ?";
    args = [since];
  }
  const { results: byDay } = await env.DB.prepare(`SELECT day, SUM(n) AS n FROM page_hits WHERE ${where} GROUP BY day ORDER BY day`).bind(...args).all();
  const { results: pages } = await env.DB.prepare(
    `SELECT path, dojo, SUM(n) AS n FROM page_hits WHERE ${where} GROUP BY path ORDER BY n DESC LIMIT 200`
  )
    .bind(...args)
    .all();
  const total = byDay.reduce((s, r) => s + r.n, 0);
  return json({ days, since, total, byDay, pages });
}

// 定时任务：删除太旧的统计
export async function purgeOldHits(env) {
  const cut = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM page_hits WHERE day < ?").bind(cut).run();
}
