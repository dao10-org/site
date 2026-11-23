-- 账号：不收集邮箱、手机号、IP。只有用户名、显示名、密码哈希、恢复码哈希。
CREATE TABLE users (
  id            TEXT PRIMARY KEY,            -- 随机 ID
  username      TEXT NOT NULL UNIQUE,        -- 登录用，小写
  display_name  TEXT NOT NULL,               -- 对外显示的署名，可随时改
  pw_hash       TEXT NOT NULL,               -- PBKDF2-SHA256
  recovery_hash TEXT NOT NULL,               -- 恢复码的 SHA-256
  role          TEXT NOT NULL DEFAULT 'user',-- user | maintainer
  created_at    TEXT NOT NULL                -- 只记到日期，不记具体时刻
);

-- 登录会话：只保存令牌的哈希，泄露数据库也无法冒充登录
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL               -- Unix 秒
);
CREATE INDEX sessions_user ON sessions(user_id);

-- 道场管理员：谁可以编辑哪个道场的二级网站
CREATE TABLE dojo_admins (
  dojo_slug TEXT NOT NULL,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (dojo_slug, user_id)
);
