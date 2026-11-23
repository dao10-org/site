// 道场目录的公共设置
// - src/zh/dojos/<代号>.md          → 道场首页 /zh/dojos/<代号>/
// - src/zh/dojos/<代号>/<页面>.md   → 该道场“二级网站”里的分页 /zh/dojos/<代号>/<页面>/
// 每个道场都可以有自己的分页，规则对所有道场相同（发起团队没有特殊待遇）。
export default {
  eleventyComputed: {
    layout: (data) =>
      isSubpage(data) ? "layouts/dojo-page.njk" : "layouts/dojo.njk",
    // 分页所属道场 = 所在文件夹名
    dojoSlug: (data) =>
      isSubpage(data) ? data.page.filePathStem.split("/").at(-2) : data.page.fileSlug,
    permalink: (data) =>
      isSubpage(data)
        ? `/zh/dojos/${data.page.filePathStem.split("/").at(-2)}/${data.page.fileSlug}/`
        : `/zh/dojos/${data.page.fileSlug}/`,
  },
};

function isSubpage(data) {
  // /zh/dojos/xxx 是道场首页；/zh/dojos/xxx/yyy 是分页
  return data.page.filePathStem.split("/").length > 4;
}
