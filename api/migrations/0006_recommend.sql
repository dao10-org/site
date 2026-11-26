-- 共道推荐：登录用户推荐外部的网站、视频号、公众号、抖音号、YouTube 频道等。
-- 不是道场，不需要签署《共道宪章》。条目内容本身在 GitHub 仓库 src/_recommends/<id>.json；
-- 这里只记去重、每日额度、谁可以撤回，以及平台管理员的“已邀请”标记（不公开）。
CREATE TABLE recommends (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,                      -- 推荐人（用于撤回和每日额度）；注销账号后为 NULL
  link_key   TEXT,                      -- 规范化后的链接，用于去重
  name_key   TEXT,                      -- 平台 + 名称，用于没有链接时去重
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'listed', -- listed 已收录 | joined 已入驻道场 | withdrawn 已撤回 | blocked 对方要求不收录
  dojo       TEXT,                      -- 入驻后的道场代号
  invited    INTEGER NOT NULL DEFAULT 0, -- 平台已发出邀请（只有平台管理员看得到）
  created_at TEXT NOT NULL              -- 只记日期
);
CREATE INDEX recommends_link ON recommends(link_key);
CREATE INDEX recommends_name ON recommends(name_key);
CREATE INDEX recommends_user ON recommends(user_id, created_at);
