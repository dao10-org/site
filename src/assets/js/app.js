// 共道文明平台 — 前端脚本（无第三方依赖、无统计、无 cookie）
(function () {
  "use strict";

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const item = (p, extra) =>
    `<li><a class="post-title" href="${esc(p.u)}">${esc(p.t)}</a>` +
    `<span class="meta">${p.d ? esc(p.d) + " · " : ""}${esc(p.a || "")}</span>` +
    `<span class="excerpt">${esc(extra || p.x || "")}</span></li>`;

  // ---------- 简繁切换（OpenCC，本地加载，仅在需要时下载） ----------
  let converter = null;
  const wantTrad = () => localStorage.getItem("gd-script") === "t";

  function convertTree(root) {
    if (!converter) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.parentElement && n.parentElement.closest("script,style,code,pre,textarea")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => (n.nodeValue = converter(n.nodeValue)));
    root.querySelectorAll?.("[placeholder],[title]").forEach((el) => {
      if (el.placeholder) el.placeholder = converter(el.placeholder);
      if (el.title) el.title = converter(el.title);
    });
  }
  window.gdConvert = convertTree;

  function loadConverter() {
    return new Promise((resolve, reject) => {
      if (converter) return resolve();
      const s = document.createElement("script");
      s.src = "/assets/vendor/opencc-cn2t.js";
      s.onload = () => {
        converter = window.OpenCC.Converter({ from: "cn", to: "twp" });
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const toggle = document.getElementById("s2t-toggle");
  if (toggle) {
    if (wantTrad()) {
      toggle.textContent = "简";
      loadConverter().then(() => {
        document.documentElement.lang = "zh-Hant";
        convertTree(document.body);
        toggle.textContent = "简";
      });
    }
    toggle.addEventListener("click", () => {
      if (wantTrad()) {
        localStorage.removeItem("gd-script");
        location.reload();
      } else {
        localStorage.setItem("gd-script", "t");
        toggle.textContent = "…";
        loadConverter().then(() => {
          document.documentElement.lang = "zh-Hant";
          convertTree(document.body);
          toggle.textContent = "简";
        });
      }
    });
  }

  // ---------- 首页：随机发现 ----------
  const all = document.getElementById("all-posts");
  const randomList = document.getElementById("random-list");
  if (all && randomList) {
    const posts = JSON.parse(all.textContent);
    const shuffle = () => {
      const a = posts.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      randomList.innerHTML = a.slice(0, 5).map((p) => item(p)).join("") || '<li class="empty">暂无文章</li>';
      convertTree(randomList);
    };
    shuffle();
    document.getElementById("reshuffle")?.addEventListener("click", shuffle);
  }

  // ---------- 搜索（静态索引，在浏览器里本地匹配，不向服务器发送关键词） ----------
  const q = document.getElementById("q");
  const results = document.getElementById("results");
  if (q && results) {
    let index = null;
    const norm = (s) => s.toLowerCase();
    fetch("/zh/search-index.json")
      .then((r) => r.json())
      .then((data) => {
        index = data;
        if (q.value) run();
      });
    const run = () => {
      if (!index) return;
      const terms = q.value.trim().split(/\s+/).filter(Boolean).map(norm);
      if (!terms.length) return (results.innerHTML = "");
      const hits = [];
      // 道场二级网站里的搜索：默认只搜本道场
      const only = q.dataset.dojo && document.querySelector("input[name=scope]:checked")?.value !== "all" ? q.dataset.dojo : "";
      for (const p of index) {
        if (only && p.s !== only) continue;
        const t = norm(p.t), b = norm(p.b);
        let score = 0, pos = -1;
        for (const term of terms) {
          const inT = t.includes(term), at = b.indexOf(term);
          if (!inT && at < 0) { score = 0; break; }
          score += (inT ? 10 : 0) + (at >= 0 ? 1 : 0);
          if (pos < 0 && at >= 0) pos = at;
        }
        if (score) {
          const start = Math.max(0, pos - 30);
          const snip = (start ? "……" : "") + p.b.slice(start, start + 100) + "……";
          hits.push({ p, score, snip });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      results.innerHTML = hits.length
        ? hits.map((h) => item(h.p, h.snip)).join("")
        : '<li class="empty">没有找到相关内容</li>';
      convertTree(results);
    };
    let timer;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 150); });
    document.querySelectorAll("input[name=scope]").forEach((r) => r.addEventListener("change", run));
  }

  // ---------- 离线下载：读取构建时生成的清单与校验码 ----------
  const dl = document.getElementById("dl-table");
  if (dl) {
    fetch("/downloads/manifest.json")
      .then((r) => r.json())
      .then((m) => {
        const kb = (n) => (n / 1024).toFixed(1) + " KB";
        dl.tBodies[0].innerHTML = m.files
          .map((f) => `<tr><td><a href="/downloads/${esc(f.file)}" download>${esc(f.file)}</a></td><td>${kb(f.bytes)}</td><td><code class="hash">${esc(f.sha256)}</code></td></tr>`)
          .join("");
      })
      .catch(() => (dl.tBodies[0].innerHTML = '<tr><td colspan="3">清单暂不可用</td></tr>'));
  }

  // ---------- 公开账目：按编号/交易尾号查找、按基金筛选（全部在本机浏览器里完成） ----------
  const lt = document.getElementById("ledger-table");
  if (lt) {
    const lq = document.getElementById("ledger-q");
    const lf = document.getElementById("ledger-fund");
    const none = document.getElementById("ledger-none");
    const rows = Array.from(lt.tBodies[0].rows);
    const apply = () => {
      const term = lq.value.trim().toLowerCase().replace(/^…/, "");
      const fund = lf.value;
      let shown = 0;
      rows.forEach((r) => {
        const ok = (!fund || r.dataset.fund.split(" ").includes(fund)) &&
          (!term || r.dataset.key.toLowerCase().includes(term));
        r.hidden = !ok;
        if (ok) shown++;
      });
      none.hidden = shown > 0;
    };
    lq.addEventListener("input", apply);
    lf.addEventListener("change", apply);
    document.querySelectorAll("[data-fund-link]").forEach((a) =>
      a.addEventListener("click", () => { lf.value = a.dataset.fundLink; lq.value = ""; apply(); })
    );
    const h = new URLSearchParams(location.search).get("id");
    if (h) { lq.value = h; apply(); }
  }

  // ---------- 分享：复制“标题 + 网址”（适合粘贴到微信群）；手机上可调用系统分享 ----------
  document.querySelectorAll(".share").forEach((box) => {
    const url = box.dataset.url;
    const title = box.dataset.title;
    const done = box.querySelector(".share-done");
    const zh = document.documentElement.lang.startsWith("zh");
    const copyBtn = box.querySelector(".share-copy");
    const field = box.querySelector(".share-url");
    const say = (msg) => { done.textContent = msg; setTimeout(() => (done.textContent = ""), 3000); };
    const text = zh ? `《${title}》\n${url}` : `${title}\n${url}`;
    async function copy() {
      try {
        await navigator.clipboard.writeText(text);
        say(zh ? "已复制，可直接粘贴到微信等聊天软件" : "Copied");
      } catch (e) {
        field.focus(); field.select();
        say(zh ? "请按 Ctrl+C（手机长按）复制" : "Press Ctrl+C to copy");
      }
    }
    copyBtn.hidden = false;
    copyBtn.addEventListener("click", copy);
    field.addEventListener("focus", () => field.select());
    if (navigator.share) {
      const nb = box.querySelector(".share-native");
      nb.hidden = false;
      nb.addEventListener("click", () => navigator.share({ title, url }).catch(() => {}));
    }
  });

  // ---------- “复制文字”按钮（例如邀请函页的转发短文字） ----------
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    const field = document.getElementById(btn.dataset.copy);
    const note = btn.parentElement.querySelector(".copy-msg");
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(field.value);
        if (note) note.textContent = "已复制，可直接粘贴到微信、留言区等";
      } catch (e) {
        field.focus(); field.select();
        if (note) note.textContent = "请按 Ctrl+C（手机长按）复制";
      }
    });
  });

  // ---------- 道场菜单的下拉：同时只展开一个，点别处收起 ----------
  const drops = Array.from(document.querySelectorAll(".nav-drop"));
  drops.forEach((d) => d.addEventListener("toggle", () => {
    if (d.open) drops.forEach((o) => { if (o !== d) o.open = false; });
  }));
  document.addEventListener("click", (e) => {
    drops.forEach((d) => { if (d.open && !d.contains(e.target)) d.open = false; });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") drops.forEach((d) => (d.open = false));
  });

  // ---------- 页头：显示登录状态（只在主站查询；镜像站、离线合集不发请求） ----------
  const accLink = document.getElementById("acc-link");
  if (accLink) {
    const setUser = (u) => {
      accLink.hidden = false; // 账号服务可用时才显示入口
      // 登录后显示“我的账号”，不显示显示名：显示名可能和平台或道场同名，容易看混
      accLink.textContent = u ? "我的账号" : "登录";
      accLink.title = u ? "已登录：" + u.displayName : "登录 / 注册";
    };
    document.addEventListener("gd-user", (e) => setUser(e.detail));
    if (location.hostname === "dao10.org") {
      fetch("/api/me", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          setUser(d.user);
          // 给其他页面脚本用（例如道场页的“管理本道场”入口）
          window.gdUser = d.user;
          document.dispatchEvent(new CustomEvent("gd-me", { detail: d.user }));
        })
        .catch(() => {});
    }
  }
})();
