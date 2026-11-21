# 共道文明平台 · 网站原型

纯静态网站（Eleventy 生成）。所有内容都是 `src/` 下的 Markdown 文件，构建结果在 `_site/`，可以放到任何主机、镜像或 U 盘里直接打开。

## 本机预览

```
npm install      # 只需第一次
npm start        # 然后浏览器打开 http://localhost:8080/
```

## 目录

| 位置 | 内容 |
|---|---|
| `src/zh/posts/` | 中文文章，一篇一个 `.md` 文件 |
| `src/zh/dojos/` | 道场介绍，一个道场一个 `.md` 文件，文件名就是道场代号 |
| `src/zh/charter.md` | 《共道宪章》草案 |
| `src/en/` | 英文页面 |
| `src/_data/site.json` | 站名、导航 |
| `src/assets/` | 样式与脚本 |

## 新增一篇文章

在 `src/zh/posts/` 新建文件，例如 `my-article.md`：

```
---
title: 文章标题
date: 2026-12-01
dojo: qingfeng            # 所属道场代号；匿名文章不写
author: 署名
anonymous: false
recommendedBy: [open-circle]   # 其他道场的推荐，自荐不计
license: CC BY-SA 4.0
---
正文……
```

## 离线合集

每次构建自动生成 `_site/downloads/gongdao-wenku-zh.html`（单文件，全部文章），并生成 SHA-256 校验码与 `manifest.json`。
