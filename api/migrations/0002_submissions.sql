-- 投稿

-- 道场成员：admin（管理员）或 member（成员）。两者都可以投稿到本道场。
ALTER TABLE dojo_admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';

-- 每日投稿额度（只计数，不记录投了哪篇，匿名投稿也不会因此和账号关联）
ALTER TABLE users ADD COLUMN sub_day TEXT;
ALTER TABLE users ADD COLUMN sub_count INTEGER NOT NULL DEFAULT 0;

-- 已发表或待发表的稿件
-- 署名稿件：user_id = 作者，作者可以在“我的投稿”里撤回
-- 匿名稿件：user_id 为空；只能凭管理密钥撤回（只存哈希）。正文在发布前暂存在 body，发布后清空。
CREATE TABLE submissions (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,            -- 仓库里的文件路径 src/zh/posts/xxx.md
  url         TEXT NOT NULL,            -- 网站上的地址 /zh/library/xxx/
  title       TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  manage_hash TEXT,
  status      TEXT NOT NULL,            -- scheduled | published | withdrawn
  publish_at  INTEGER NOT NULL,         -- Unix 秒
  file        TEXT                      -- 匿名稿件发布前暂存的完整文件内容
);
CREATE INDEX submissions_user ON submissions(user_id);
CREATE INDEX submissions_due ON submissions(status, publish_at);

-- AI 审核每月统计（只有数字，不存稿件内容），用于“AI 审核透明度”页面
CREATE TABLE moderation_stats (
  month    TEXT PRIMARY KEY,            -- 2026-11
  passed   INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0
);
