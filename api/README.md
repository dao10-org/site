# 账号后台（dao10-api）

Cloudflare Worker + D1 数据库，只处理 `dao10.org/api/*`。主站和所有道场二级网站在同一个域名下，登录一次全站通用。

- 不收集邮箱、手机号、IP；密码、登录令牌、恢复码只存哈希
- 和 AU139 完全分开：独立的数据库，部署在 gongdaowenming 的 Cloudflare 账号

## 测试（不需要 Cloudflare）

```
cd api
node --test test/auth.test.mjs
```

## 部署（必须用共道的 Cloudflare 账号）

本机的环境变量 CLOUDFLARE_API_TOKEN 指向 AU139 账号，所以所有命令前面都要加 `env -u CLOUDFLARE_API_TOKEN`：

```
env -u CLOUDFLARE_API_TOKEN npx wrangler whoami                       # 确认是共道的账号
env -u CLOUDFLARE_API_TOKEN npx wrangler d1 migrations apply dao10-db --remote
env -u CLOUDFLARE_API_TOKEN npx wrangler deploy
```

## 设道场管理员

```
env -u CLOUDFLARE_API_TOKEN npx wrangler d1 execute dao10-db --remote --command \
  "INSERT INTO dojo_admins SELECT 'gongdao-team', id FROM users WHERE username = '用户名'"
```
