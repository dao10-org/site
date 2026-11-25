-- 网页打开次数：只记“哪一天、哪一页、打开了几次”。
-- 不记 IP、不用 Cookie、不记设备，无法知道是谁打开的，也不统计人数。保留约 400 天。
CREATE TABLE page_hits (
  day   TEXT NOT NULL,              -- 日期（UTC）
  path  TEXT NOT NULL,              -- 网页路径，例如 /zh/dojos/gongsheng/
  dojo  TEXT NOT NULL DEFAULT '',   -- 所属道场代号（道场页面和道场名下的文章），平台页面为空
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
CREATE INDEX page_hits_dojo ON page_hits(dojo, day);

-- 平台管理员（可以看全站统计）：发起团队的账号
UPDATE users SET role = 'admin' WHERE username = 'gongdaowenming';
