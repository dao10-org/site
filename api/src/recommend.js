// 共道推荐：登录用户推荐外部的网站、视频号、公众号、抖音号、YouTube 频道等
//
// - 不是道场，不需要签署《共道宪章》，只是一个索引：名称 + 链接（或账号名）+ 一句介绍 + 可选一张图
// - AI 只按两条底线审核推荐人写的文字（它看不到对方的视频），通过即收录
// - 同一个链接（或同一平台同名账号）只收录一次
// - 推荐人可以撤回；平台管理员可以移除（例如对方本人要求不被收录，以后也不再收录）、
//   标记“已邀请”（不公开）、标记“已入驻”并链接到道场
// - 条目存在仓库 src/_recommends/<id>.json，图片在 src/assets/recommends/；每条 = 一次提交
import { HttpError, json, requireUser, randomId, today } from "./index.js";
import { moderate, countStat } from "./submit.js";
import { gh, githubCommit, decodeImage } from "./dojo.js";

const DIR = "src/_recommends";
const IMG_DIR = "src/assets/recommends";
const DAILY = 5; // 每人每天最多推荐几条（每条都会重建一次网站）

const filePath = (id) => `${DIR}/${id}.json`;

// ---------------- 推荐 ----------------
export async function recommend(request, body, env) {
  if (!env.GITHUB_TOKEN) throw new HttpError(503, "推荐功能还在开通中，请稍后再试");
  const user = await requireUser(request, env);
  if (!body.agree) throw new HttpError(400, "请先确认推荐须知");

  const name = text(body.name, "名称", 1, 40);
  const platform = text(body.platform, "平台", 1, 12);
  const link = checkLink(body.link);
  const account = text(body.account, "账号或搜索名", 0, 60);
  const intro = text(body.intro, "推荐理由", 10, 300);
  const tags = [...new Set((Array.isArray(body.tags) ? body.tags : []).map((t) => text(t, "标签", 1, 10)))];
  if (tags.length > 6) throw new HttpError(400, "标签最多 6 个");
  if (!link && !account) throw new HttpError(400, "请填写链接；没有链接的（例如视频号），请填写账号名称或 ID，方便读者搜索");
  const image = body.image ? decodeImage(body.image) : null;

  // 去重
  const linkKey = link ? normLink(link) : null;
  const nameKey = `${platform}:${name.toLowerCase().replace(/\s+/g, "")}`;
  const dup = await env.DB.prepare(
    "SELECT id, status FROM recommends WHERE status != 'withdrawn' AND (link_key = ? OR name_key = ?) LIMIT 1"
  )
    .bind(linkKey, nameKey)
    .first();
  if (dup?.status === "blocked") throw new HttpError(409, "对方已要求不被收录，所以不能推荐");
  if (dup) return json({ status: "duplicate", url: `/zh/recommend/#r-${dup.id}` });

  // 每日额度
  const day = today();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM recommends WHERE user_id = ? AND created_at = ?").bind(user.id, day).first();
  if (n >= DAILY) throw new HttpError(429, `每个账号每天最多推荐 ${DAILY} 条，请明天再来`);

  // AI 审核（只看文字）
  const all = [`平台：${platform}`, account && `账号：${account}`, link && `链接：${link}`, `推荐理由：${intro}`, tags.length && `标签：${tags.join("、")}`]
    .filter(Boolean)
    .join("\n");
  const verdict = await moderate(env, `共道推荐（推荐别人在外部平台的账号或网站，不是冒充）：${name}`, all);
  await countStat(env, verdict.ok);
  if (!verdict.ok) return json({ status: "rejected", reason: verdict.reason });

  const id = randomId(9).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || randomId(6).toLowerCase();
  const files = {};
  let src = "";
  if (image) {
    src = `/assets/recommends/${id}.${image.ext}`;
    files[`${IMG_DIR}/${id}.${image.ext}`] = image.bytes;
  }
  const entry = {
    id,
    name,
    platform,
    link,
    account,
    intro,
    tags,
    image: src,
    by: body.hideName ? "" : user.display_name, // 空 = 显示“一位道友”
    date: day,
    status: "listed",
    dojo: "",
  };
  files[filePath(id)] = JSON.stringify(entry, null, 2) + "\n";
  await githubCommit(env, files, `共道推荐：${name}`);
  await env.DB.prepare(
    "INSERT INTO recommends (id, user_id, link_key, name_key, name, status, created_at) VALUES (?, ?, ?, ?, ?, 'listed', ?)"
  )
    .bind(id, user.id, linkKey, nameKey, name, day)
    .run();
  return json({ status: "listed", id, url: `/zh/recommend/#r-${id}` });
}

// ---------------- 我能管理的条目 ----------------
// 普通用户：自己推荐的；平台管理员：全部（含“已邀请”标记和已移除的）
export async function myRecommends(request, env) {
  const user = await requireUser(request, env);
  const admin = user.role === "admin";
  const { results } = admin
    ? await env.DB.prepare("SELECT id, name, status, dojo, invited, created_at AS date FROM recommends ORDER BY created_at DESC LIMIT 1000").all()
    : await env.DB.prepare("SELECT id, name, status, dojo, created_at AS date FROM recommends WHERE user_id = ? AND status != 'withdrawn' ORDER BY created_at DESC")
        .bind(user.id)
        .all();
  return json({ admin, items: results });
}

// ---------------- 操作 ----------------
// withdraw（推荐人或平台管理员撤回）| block（平台管理员：对方要求不收录，以后也不能再推荐）
// invite / uninvite（平台管理员：已邀请标记，不公开）| join（平台管理员：已入驻，body.dojo = 道场代号）| unjoin
export async function recommendAction(request, body, env) {
  const user = await requireUser(request, env);
  const admin = user.role === "admin";
  const row = await env.DB.prepare("SELECT * FROM recommends WHERE id = ?").bind(String(body.id || "")).first();
  if (!row || row.status === "withdrawn" || (row.status === "blocked" && body.action !== "unblock")) throw new HttpError(404, "没有找到这条推荐");
  const action = String(body.action || "");
  const own = row.user_id && row.user_id === user.id;
  if (!admin && !(own && action === "withdraw")) throw new HttpError(403, "只有推荐人或平台管理员可以这样操作");

  switch (action) {
    case "withdraw":
    case "block": {
      if (action === "block" && !admin) throw new HttpError(403, "只有平台管理员可以这样操作");
      const entry = await readEntry(env, row.id);
      const files = { [filePath(row.id)]: null };
      if (entry?.image) files[`src${entry.image}`] = null;
      if (entry) await githubCommit(env, files, action === "block" ? `共道推荐：应对方要求移除 ${row.name}` : `共道推荐：撤回 ${row.name}`);
      if (action === "block") {
        await env.DB.prepare("UPDATE recommends SET status = 'blocked', invited = 0 WHERE id = ?").bind(row.id).run();
      } else {
        // 撤回：去重标记一并清掉（以后别人还可以再推荐）；保留这一行只为计算当天额度
        await env.DB.prepare("UPDATE recommends SET status = 'withdrawn', link_key = NULL, name_key = NULL, invited = 0 WHERE id = ?").bind(row.id).run();
      }
      return json({ ok: true });
    }
    case "unblock":
      if (row.status !== "blocked") throw new HttpError(400, "这条推荐没有被移除");
      // 解除后可以重新推荐（原条目已删除，不会自动恢复）
      await env.DB.prepare("UPDATE recommends SET status = 'withdrawn', link_key = NULL, name_key = NULL WHERE id = ?").bind(row.id).run();
      return json({ ok: true });
    case "invite":
    case "uninvite":
      await env.DB.prepare("UPDATE recommends SET invited = ? WHERE id = ?").bind(action === "invite" ? 1 : 0, row.id).run();
      return json({ ok: true });
    case "join":
    case "unjoin": {
      const dojo = action === "join" ? String(body.dojo || "").trim() : "";
      if (action === "join" && !/^[a-z0-9-]{2,40}$/.test(dojo)) throw new HttpError(400, "道场代号不对");
      const entry = await readEntry(env, row.id);
      if (!entry) throw new HttpError(404, "仓库里没有这条推荐");
      entry.status = dojo ? "joined" : "listed";
      entry.dojo = dojo;
      await githubCommit(env, { [filePath(row.id)]: JSON.stringify(entry, null, 2) + "\n" }, `共道推荐：${row.name}${dojo ? " 已入驻" : " 取消入驻标记"}`);
      await env.DB.prepare("UPDATE recommends SET status = ?, dojo = ? WHERE id = ?").bind(entry.status, dojo || null, row.id).run();
      return json({ ok: true });
    }
    default:
      throw new HttpError(400, "操作不对");
  }
}

async function readEntry(env, id) {
  const f = await gh(env, "GET", `/contents/${filePath(id)}?ref=main`);
  if (!f) return null;
  const bytes = Uint8Array.from(atob(f.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ---------------- 校验 ----------------
function text(v, name, min, max) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (s.length < min || s.length > max) throw new HttpError(400, min ? `${name}需要 ${min}–${max} 个字` : `${name}不能超过 ${max} 个字`);
  if (/[<>]/.test(s)) throw new HttpError(400, `${name}不能包含 < 或 >`);
  return s;
}

function checkLink(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, "链接格式不对，请复制完整网址（以 https:// 开头）；没有网址的就留空，填写账号名称");
  }
  if (!["http:", "https:"].includes(u.protocol) || s.length > 500) throw new HttpError(400, "链接格式不对");
  return u.href;
}

// 去重用：忽略 http/https、www.、m.、大小写、结尾斜杠、#… 和常见的分享追踪参数
export function normLink(href) {
  const u = new URL(href);
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const params = [...u.searchParams].filter(([k]) => !/^(utm_|si$|feature$|share|from$|spm|igsh|ref$|s$|t$)/i.test(k));
  params.sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? "?" + new URLSearchParams(params).toString() : "";
  return host + u.pathname.replace(/\/+$/, "").toLowerCase() + q;
}
