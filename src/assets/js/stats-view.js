// 访问统计的显示（道场管理页和平台统计页共用）
// window.gdStats(容器, 查询参数) —— 查询参数为 "slug=xxx"（本道场）或 ""（全站）
(function () {
  "use strict";
  let titles = null;
  const loadTitles = () =>
    titles ||
    (titles = fetch("/zh/search-index.json")
      .then((r) => r.json())
      .then((list) => {
        const m = { "/zh/": "首页", "/en/": "English home" };
        list.forEach((x) => (m[x.u] = x.t));
        return m;
      })
      .catch(() => ({})));
  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props || {});
    kids.forEach((k) => e.append(k));
    return e;
  };

  window.gdStats = async function (box, query) {
    box.textContent = "";
    const pick = el("select", {});
    [[7, "最近 7 天"], [30, "最近 30 天"], [90, "最近 90 天"], [365, "最近一年"]].forEach(([v, t]) =>
      pick.append(el("option", { value: v, textContent: t, selected: v === (box._days || 30) }))
    );
    const out = el("div", {});
    box.append(el("p", {}, pick), out);
    pick.addEventListener("change", () => { box._days = +pick.value; show(); });

    async function show() {
      out.textContent = "正在加载……";
      try {
        const [res, names] = await Promise.all([
          fetch("/api/stats?" + query + (query ? "&" : "") + "days=" + (box._days || 30), { credentials: "same-origin" }),
          loadTitles(),
        ]);
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "出错了");
        out.textContent = "";
        out.append(el("p", { className: "gd-stats-total" }, el("strong", { textContent: d.total.toLocaleString() }), " 次打开"));
        if (!d.total) return out.append(el("p", { className: "meta", textContent: "这段时间还没有记录。统计从功能上线那天开始。" }));

        // 每天的柱状图（补齐没有记录的日子）
        const per = Object.fromEntries(d.byDay.map((r) => [r.day, r.n]));
        const days = [];
        for (let t = new Date(d.since + "T00:00:00Z"); t <= new Date(); t = new Date(t.getTime() + 86400000)) days.push(t.toISOString().slice(0, 10));
        const max = Math.max(1, ...days.map((x) => per[x] || 0));
        const chart = el("div", { className: "gd-bars", role: "img", ariaLabel: "每天打开次数" });
        days.forEach((x) => chart.append(el("span", { title: `${x}：${per[x] || 0} 次`, style: `height:${Math.max(2, ((per[x] || 0) / max) * 100)}%` })));
        out.append(chart, el("p", { className: "meta gd-bars-axis" }, el("span", { textContent: days[0] }), el("span", { textContent: days[days.length - 1] })));

        // 各页面
        const tb = el("tbody", {});
        d.pages.forEach((r) =>
          tb.append(el("tr", {},
            el("td", {}, el("a", { href: r.path, textContent: names[r.path] || r.path })),
            el("td", { className: "num", textContent: r.n.toLocaleString() })))
        );
        out.append(el("div", { className: "table-scroll" }, el("table", { className: "dl-table" },
          el("thead", {}, el("tr", {}, el("th", { textContent: "页面" }), el("th", { className: "num", textContent: "打开次数" }))), tb)));
      } catch (e) {
        out.textContent = e.message;
      }
    }
    show();
  };
})();
