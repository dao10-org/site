// 共道文明平台 — Eleventy 配置
// 内容全部是 src/ 下的 Markdown 文件；构建结果输出到 _site/（纯静态 HTML，可放到任何主机或镜像）。
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";

export default function (eleventyConfig) {
  // ---- 静态资源 ----
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" }); // 短网址
  // 简繁转换库（本地托管，不依赖任何第三方 CDN，大陆和海外都能加载）
  eleventyConfig.addPassthroughCopy({
    "node_modules/opencc-js/dist/umd/cn2t.js": "assets/vendor/opencc-cn2t.js",
  });

  // ---- 内容集合 ----
  const byDateDesc = (a, b) => b.date - a.date;
  eleventyConfig.addCollection("posts_zh", (api) =>
    api.getFilteredByGlob("src/zh/posts/*.md").sort(byDateDesc)
  );
  eleventyConfig.addCollection("posts_en", (api) =>
    api.getFilteredByGlob("src/en/posts/*.md").sort(byDateDesc)
  );
  eleventyConfig.addCollection("dojos_zh", (api) =>
    api
      .getFilteredByGlob("src/zh/dojos/*.md")
      .filter((d) => !d.data.draft) // draft: true 的道场（尚未获本人同意）不出现
      .sort((a, b) => a.data.joined.localeCompare(b.data.joined))
  );
  // 道场“二级网站”的分页：src/zh/dojos/<代号>/*.md，按 order 排序
  eleventyConfig.addCollection("dojopages_zh", (api) =>
    api
      .getFilteredByGlob("src/zh/dojos/*/*.md")
      .sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99))
  );

  // ---- 过滤器 ----
  eleventyConfig.addFilter("ymd", (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().slice(0, 10);
  });

  // 根据道场代号找到道场页面
  eleventyConfig.addFilter("dojo", (slug, dojos) =>
    (dojos || []).find((d) => d.fileSlug === slug)
  );

  // 某道场的分页
  eleventyConfig.addFilter("pagesOf", (pages, slug) =>
    (pages || []).filter((p) => p.data.dojoSlug === slug && p.data.inNav !== false)
  );

  // 某道场名下的文章
  eleventyConfig.addFilter("postsOf", (posts, slug) =>
    (posts || []).filter((p) => p.data.dojo === slug)
  );

  // 有效推荐：只算“其他道场”的推荐，自荐不计
  const validRecs = (p) =>
    [...new Set(p.data.recommendedBy || [])].filter((r) => r !== p.data.dojo);
  eleventyConfig.addFilter("validRecs", validRecs);
  eleventyConfig.addFilter("others", (recs, self) => [...new Set(recs || [])].filter((r) => r !== self));
  eleventyConfig.addFilter("recommended", (posts, n = 6) =>
    (posts || [])
      .filter((p) => validRecs(p).length > 0)
      .sort((a, b) => validRecs(b).length - validRecs(a).length || b.date - a.date)
      .slice(0, n)
  );

  eleventyConfig.addFilter("head", (arr, n) => (arr || []).slice(0, n));

  // 纯文本摘要（用于列表、搜索索引）
  const plain = (html) =>
    String(html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  eleventyConfig.addFilter("plain", plain);
  eleventyConfig.addFilter("excerpt", (html, n = 90) => {
    const t = plain(html);
    return t.length > n ? t.slice(0, n) + "……" : t;
  });

  // Markdown 原文 → 纯文本摘要（用于分享卡片的描述）
  eleventyConfig.addFilter("mdExcerpt", (md, n = 110) => {
    const t = String(md || "")
      .replace(/^---[\s\S]*?---/, "")          // 去掉 front matter
      .replace(/<[^>]+>/g, " ")                   // HTML 标签
      .replace(/\{[%{][\s\S]*?[%}]\}/g, " ")   // 模板语句
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接只留文字
      .replace(/[#>*_`|~-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return t.length > n ? t.slice(0, n) + "……" : t;
  });

  // 长文目录：给每个 h2 加锚点（如 #第一章、#引言），可以直接分享到某一章
  // 返回 { html, toc }
  eleventyConfig.addFilter("chapters", (html) => {
    const toc = [];
    const used = new Set();
    const out = String(html || "").replace(/<h2>([\s\S]*?)<\/h2>/g, (all, inner) => {
      const text = inner.replace(/<[^>]+>/g, "").trim();
      let id = text.split(/[：:]/)[0].replace(/[\s"'<>#?&]+/g, "") || "ch";
      while (used.has(id)) id += "-";
      used.add(id);
      toc.push({ id, text });
      return `<h2 id="${id}">${inner}</h2>`;
    });
    return { html: out, toc };
  });

  // URL 编码（分享链接用）
  eleventyConfig.addFilter("enc", (s) => encodeURIComponent(String(s ?? "")));

  // ---- 构建完成后：为离线合集生成 SHA-256 校验文件和清单 ----
  eleventyConfig.on("eleventy.after", async ({ dir }) => {
    const dl = path.join(dir.output, "downloads");
    await mkdir(dl, { recursive: true });
    const files = (await readdir(dl)).filter(
      (f) => !f.endsWith(".sha256") && f !== "manifest.json"
    );
    const manifest = [];
    for (const f of files) {
      const buf = await readFile(path.join(dl, f));
      const sha256 = createHash("sha256").update(buf).digest("hex");
      await writeFile(path.join(dl, f + ".sha256"), `${sha256}  ${f}\n`);
      manifest.push({ file: f, bytes: buf.length, sha256 });
    }
    await writeFile(
      path.join(dl, "manifest.json"),
      JSON.stringify({ generated: new Date().toISOString(), files: manifest }, null, 2)
    );
  });

  return {
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
