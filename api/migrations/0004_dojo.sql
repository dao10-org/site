-- 道场管理：编辑次数、站内留言开关、留言

-- 每个道场的设置与每日编辑次数（每次保存会重建一次网站，所以限次）
CREATE TABLE dojo_meta (
  slug       TEXT PRIMARY KEY,
  relay      INTEGER NOT NULL DEFAULT 0,  -- 1 = 开启站内留言
  edit_day   TEXT,
  edit_count INTEGER NOT NULL DEFAULT 0
);

-- 站内留言：读者不需要知道道场的联系方式，道场也不需要公开身份。
-- 不记录留言人的 IP 或账号；时间只记到日期。180 天后自动删除。
CREATE TABLE dojo_messages (
  id         TEXT PRIMARY KEY,
  dojo_slug  TEXT NOT NULL,
  body       TEXT NOT NULL,
  contact    TEXT,                        -- 留言人自愿留下的回复方式，可为空
  created_at TEXT NOT NULL,               -- 只记日期
  is_read    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX dojo_messages_slug ON dojo_messages(dojo_slug, created_at);
