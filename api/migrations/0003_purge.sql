-- 撤回后清除 Cloudflare 缓存：网站重建需要一两分钟，重建前有人访问会把旧页面重新缓存，
-- 所以撤回时先清一次，定时任务（网站重建完成后）再清一次。purge_at = 待清除时间（Unix 秒），NULL = 不需要
ALTER TABLE submissions ADD COLUMN purge_at INTEGER;
