// 道场管理页面：修改道场介绍（文字、标识、图片、联系方式、站内留言）、管理成员、看留言
// 所有用户内容都用 textContent / value 放进页面，不用 innerHTML。
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const msg = $("da-msg");
  const say = (t, bad) => {
    msg.textContent = t || "";
    msg.classList.toggle("bad", !!bad);
  };
  const names = JSON.parse($("dojo-names").textContent || "{}");
  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props || {});
    kids.forEach((k) => k != null && e.append(k));
    return e;
  };

  async function api(path, body) {
    const init = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }
      : { credentials: "same-origin" };
    const res = await fetch("/api/" + path, init);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    if (!data) throw Object.assign(new Error("无法连接服务器，请稍后再试"), { offline: true });
    if (!res.ok) throw Object.assign(new Error(data.error || "出错了"), { status: res.status });
    return data;
  }

  const only = (id) => ["da-loading", "da-guest", "da-none", "da-pick", "da-main", "da-offline"].forEach((x) => ($(x).hidden = x !== id));

  // ---------------- 状态 ----------------
  let slug = "";
  let version = null;
  let images = []; // [{src, caption}]；新图片 src = "new:编号"
  let logo = "";
  let uploads = {}; // 编号 → dataURL（尚未保存的新图片）
  const preview = {}; // src → 可显示的地址（新图片保存后，网站重建前用本地预览）
  let relayOn = false;
  const form = $("da-profile");
  const show = (src) => preview[src] || (src.startsWith("new:") ? uploads[src.slice(4)] : src);

  // ---------------- 图片处理：在浏览器里缩小、重新编码（同时去掉 EXIF 等信息） ----------------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("无法读取这张图片（" + file.name + "）。请换成 JPG 或 PNG 格式"));
      img.src = url;
    });
  }
  async function shrink(file, { max, square }) {
    const img = await loadImage(file);
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (square) {
      const s = Math.min(sw, sh);
      sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s;
    }
    const scale = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext("2d");
    const png = square && file.type === "image/png"; // 标识保留透明背景
    if (!png) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const out = png ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85);
    if (out.length > 2.6e6) throw new Error("图片处理后仍然太大，请换一张");
    return out;
  }
  let seq = 0;
  const addUpload = (dataUrl) => {
    const key = "u" + Date.now().toString(36) + seq++;
    uploads[key] = dataUrl;
    return "new:" + key;
  };

  // ---------------- 标识 ----------------
  function renderLogo() {
    const img = $("da-logo-img");
    img.hidden = !logo;
    if (logo) img.src = show(logo);
    $("da-logo-del").hidden = !logo;
    $("da-logo-pick").textContent = logo ? "更换标识" : "上传标识";
  }
  $("da-logo-pick").addEventListener("click", () => $("da-logo-file").click());
  $("da-logo-del").addEventListener("click", () => {
    logo = "";
    renderLogo();
  });
  $("da-logo-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      logo = addUpload(await shrink(f, { max: 512, square: true }));
      renderLogo();
      say("标识已放好，记得点“保存”");
    } catch (err) {
      say(err.message, true);
    }
  });

  // ---------------- 图片 ----------------
  function renderImages() {
    const box = $("da-images");
    box.textContent = "";
    images.forEach((im, i) => {
      const cap = el("input", { value: im.caption || "", maxLength: 100, placeholder: "图片说明（可选）" });
      cap.addEventListener("input", () => (im.caption = cap.value));
      const btn = (text, fn, disabled) => {
        const b = el("button", { type: "button", className: "tool-btn small", textContent: text, disabled: !!disabled });
        b.addEventListener("click", fn);
        return b;
      };
      const move = (d) => () => {
        images.splice(i + d, 0, images.splice(i, 1)[0]);
        renderImages();
      };
      box.append(
        el(
          "div",
          { className: "da-image" },
          el("img", { src: show(im.src), alt: "" }),
          cap,
          el(
            "div",
            {},
            btn("← 前移", move(-1), i === 0),
            btn("后移 →", move(1), i === images.length - 1),
            btn("删除", () => {
              images.splice(i, 1);
              renderImages();
            })
          )
        )
      );
    });
    $("da-img-pick").disabled = images.length >= 12;
  }
  $("da-img-pick").addEventListener("click", () => $("da-img-file").click());
  $("da-img-file").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    for (const f of files) {
      if (images.length >= 12) {
        say("图片最多 12 张", true);
        break;
      }
      try {
        images.push({ src: addUpload(await shrink(f, { max: 1600 })), caption: "" });
      } catch (err) {
        say(err.message, true);
      }
    }
    renderImages();
  });

  // ---------------- 联系方式 ----------------
  function contactRow(c) {
    const label = el("input", { value: c.label || "", maxLength: 20, placeholder: "名称，例如 公众号、YouTube、邮箱" });
    const value = el("input", { value: c.value || "", maxLength: 300, placeholder: "内容，例如 账号名称或网址" });
    const del = el("button", { type: "button", className: "tool-btn small", textContent: "删除" });
    const row = el("div", { className: "da-contact" }, label, value, del);
    del.addEventListener("click", () => row.remove());
    $("da-contacts").append(row);
  }
  $("da-contact-add").addEventListener("click", () => contactRow({}));

  // ---------------- 填表 / 读表 ----------------
  let tagsExtra = [];
  function fill(p) {
    ["title", "subtitle", "kind", "location", "summary", "intro", "website"].forEach((k) => (form.elements[k].value = p[k] || ""));
    form.elements.relay.checked = !!p.relay;
    relayOn = !!p.relay;
    // 标签：勾上已选的；列表里没有的旧标签原样保留（不会因为改了列表就丢掉）
    tagsExtra = (p.tags || []).filter((t) => ![...form.querySelectorAll("input[name=tag]")].some((c) => c.value === t));
    form.querySelectorAll("input[name=tag]").forEach((c) => (c.checked = (p.tags || []).includes(c.value)));
    logo = p.logo || "";
    images = (p.images || []).map((x) => ({ ...x }));
    $("da-contacts").textContent = "";
    (p.contacts || []).forEach(contactRow);
    if (!(p.contacts || []).length) contactRow({});
    renderLogo();
    renderImages();
    $("da-relay-off").hidden = relayOn;
  }
  function read() {
    const p = {};
    ["title", "subtitle", "kind", "location", "summary", "intro", "website"].forEach((k) => (p[k] = form.elements[k].value));
    p.relay = form.elements.relay.checked;
    p.tags = [...form.querySelectorAll("input[name=tag]:checked")].map((c) => c.value).concat(tagsExtra);
    p.logo = logo;
    p.images = images.map(({ src, caption }) => ({ src, caption }));
    p.contacts = [...$("da-contacts").children].map((r) => {
      const [l, v] = r.querySelectorAll("input");
      return { label: l.value, value: v.value };
    });
    return p;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    say("正在审核和保存，可能需要几十秒……");
    try {
      const used = {};
      const p = read();
      [p.logo, ...p.images.map((i) => i.src)].forEach((s) => s && s.startsWith("new:") && (used[s.slice(4)] = uploads[s.slice(4)]));
      const before = [p.logo, ...p.images.map((i) => i.src)];
      const r = await api("dojo/save", { slug, version, profile: p, uploads: used });
      if (r.status === "rejected") {
        say("");
        result("bad", "没有通过审核，未保存", ["AI 认为：" + (r.reason || "越过了底线"), "可以修改后再保存。如果认为判断有误，请写信到 report@dao10.org。"]);
        return;
      }
      // 新图片：网站重建前先用本地预览显示
      const after = [r.profile.logo, ...r.profile.images.map((i) => i.src)];
      before.forEach((s, i) => s && s.startsWith("new:") && after[i] && (preview[after[i]] = uploads[s.slice(4)]));
      uploads = {};
      version = r.version;
      fill(r.profile);
      $("da-title").textContent = r.profile.title;
      say("");
      result("ok", "已保存", ["约 1–2 分钟后道场页面更新。"], r.url);
    } catch (err) {
      say(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  function result(kind, title, lines, href) {
    const box = $("da-result");
    box.textContent = "";
    box.className = "notice result " + kind;
    box.append(el("h2", { textContent: title }));
    lines.forEach((t) => box.append(el("p", { textContent: t })));
    if (href) box.append(el("p", {}, el("a", { href, textContent: "查看道场页面 →" })));
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------------- 成员 ----------------
  const ROLE = { admin: "管理员", member: "成员" };
  function renderMembers(list) {
    const ul = $("da-members");
    ul.textContent = "";
    list.forEach((m) => {
      const act = (text, action) => {
        const b = el("button", { type: "button", className: "tool-btn small", textContent: text });
        b.addEventListener("click", async () => {
          if (action === "remove" && b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            b.textContent = "确定移出？再点一次";
            return;
          }
          b.disabled = true;
          try {
            const r = await api("dojo/member", { slug, username: m.username, action });
            if (r.self && action !== "admin") return location.reload(); // 自己不再是管理员
            await reload();
            say("已更新");
          } catch (err) {
            say(err.message, true);
            b.disabled = false;
          }
        });
        return b;
      };
      ul.append(
        el(
          "li",
          {},
          el("span", { className: "post-title", textContent: m.displayName }),
          el(
            "span",
            { className: "meta" },
            "用户名 " + m.username + " · ",
            el("span", { className: "badge" + (m.role === "admin" ? "" : " muted"), textContent: ROLE[m.role] || m.role }),
            m.role === "admin" ? act("改为成员", "member") : act("设为管理员", "admin"),
            act("移出道场", "remove")
          )
        )
      );
    });
  }
  $("da-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("dojo/member", { slug, username: f.elements.username.value, action: f.elements.action.value });
      f.reset();
      await reload();
      say("已添加");
    } catch (err) {
      say(err.message, true);
    }
  });

  // ---------------- 留言 ----------------
  let messages = [];
  function renderMessages() {
    const ul = $("da-messages");
    ul.textContent = "";
    if (!messages.length) ul.append(el("li", { className: "empty", textContent: "还没有留言" }));
    messages.forEach((m) => {
      const del = el("button", { type: "button", className: "tool-btn small", textContent: "删除" });
      del.addEventListener("click", async () => {
        if (del.dataset.sure !== "1") {
          del.dataset.sure = "1";
          del.textContent = "确定删除？再点一次";
          return;
        }
        try {
          await api("dojo/messages", { slug, id: m.id, action: "delete" });
          messages = messages.filter((x) => x !== m);
          renderMessages();
        } catch (err) {
          say(err.message, true);
        }
      });
      ul.append(
        el(
          "li",
          { className: m.isRead ? "" : "unread" },
          el("p", { className: "da-msg-body", textContent: m.body }),
          el(
            "span",
            { className: "meta" },
            m.date + (m.isRead ? "" : " · 新") + " · " + (m.contact ? "回复方式：" + m.contact : "没有留下回复方式") + " ",
            del
          )
        )
      );
    });
    const n = messages.filter((m) => !m.isRead).length;
    $("da-unread").textContent = n ? "（" + n + " 条新）" : "";
  }
  async function markRead() {
    const ids = messages.filter((m) => !m.isRead).map((m) => m.id);
    if (!ids.length) return;
    try {
      await api("dojo/messages", { slug, ids, action: "read" });
    } catch (e) {}
  }

  // ---------------- 切换标签 ----------------
  document.querySelectorAll(".dojo-admin .tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".dojo-admin .tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      document.querySelectorAll("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== t.dataset.tab));
      $("da-result").hidden = true;
      say("");
      if (t.dataset.tab === "messages") {
        renderMessages();
        markRead().then(() => messages.forEach((m) => (m.isRead = 1)));
      }
    })
  );

  // ---------------- 加载 ----------------
  async function reload() {
    const d = await api("dojo?slug=" + encodeURIComponent(slug));
    renderMembers(d.members);
    messages = d.messages;
    renderMessages();
    return d;
  }

  async function start() {
    if (location.hostname !== "dao10.org" && location.hostname !== "localhost") return only("da-offline");
    let me;
    try {
      me = (await api("me")).user;
    } catch (e) {
      return only("da-offline");
    }
    if (!me) return only("da-guest");
    const mine = me.dojos || [];
    if (!mine.length) return only("da-none");
    slug = new URLSearchParams(location.search).get("d") || (mine.length === 1 ? mine[0] : "");
    if (!mine.includes(slug)) {
      const ul = $("da-pick-list");
      mine.forEach((s) => ul.append(el("li", {}, el("a", { href: "?d=" + encodeURIComponent(s), textContent: names[s] || s }))));
      return only("da-pick");
    }
    try {
      const d = await reload();
      version = d.version;
      fill(d.profile);
      $("da-title").textContent = d.profile.title || names[slug] || slug;
      $("da-view").href = "/zh/dojos/" + encodeURIComponent(slug) + "/";
      only("da-main");
    } catch (err) {
      only("da-main");
      $("da-main").hidden = true;
      say(err.message, true);
    }
  }
  start();
})();
