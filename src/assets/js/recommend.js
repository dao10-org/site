// 共道推荐：列表页（筛选、复制账号名、推荐人撤回、平台管理员操作）和推荐表单页
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const msg = $("rec-msg");
  const say = (t, bad) => {
    if (!msg) return;
    msg.textContent = t || "";
    msg.classList.toggle("bad", !!bad);
  };
  const el = (tag, props = {}, kids = []) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    kids.forEach((k) => e.appendChild(typeof k === "string" ? document.createTextNode(k) : k));
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
    if (!data) throw Object.assign(new Error("offline"), { offline: true });
    if (!res.ok) throw Object.assign(new Error(data.error || "出错了"), { status: res.status });
    return data;
  }

  // ---------------- 复制账号名 ----------------
  document.querySelectorAll("[data-copytext]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copytext);
        btn.textContent = "已复制";
      } catch (e) {
        btn.textContent = "请长按选中复制";
      }
      setTimeout(() => (btn.textContent = "复制"), 2000);
    })
  );

  // ---------------- 按平台筛选 ----------------
  const filter = $("rec-filter");
  if (filter) {
    filter.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-p]");
      if (!b) return;
      filter.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      document.querySelectorAll(".rec").forEach((c) => (c.hidden = !!b.dataset.p && c.dataset.p !== b.dataset.p));
    });
  }

  // ---------------- 列表页：推荐人和平台管理员的操作 ----------------
  if (document.querySelector(".recommend") && location.hostname.match(/(^|\.)dao10\.org$|^localhost$/)) {
    api("recommend/mine")
      .then((d) => manage(d))
      .catch(() => {}); // 没登录：什么都不显示
  }

  // 删除类操作点两次才执行（不用浏览器弹窗）
  function twice(btn, label, run) {
    let armed = false;
    btn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        btn.textContent = "再点一次确认" + label;
        setTimeout(() => {
          armed = false;
          btn.textContent = label;
        }, 4000);
        return;
      }
      run();
    });
  }

  async function act(body, done) {
    try {
      await api("recommend/action", body);
      say("已完成。网站大约 1–2 分钟后更新。");
      done && done();
    } catch (err) {
      say(err.offline ? "无法连接服务，请稍后再试" : err.message, true);
    }
  }

  function manage(d) {
    const admin = !!d.admin;
    for (const it of d.items) {
      if (it.status === "blocked" || it.status === "withdrawn") continue;
      const card = $("r-" + it.id);
      if (!card) continue;
      const tools = card.querySelector(".rec-tools");
      tools.textContent = "";
      tools.hidden = false;

      const wd = el("button", { type: "button", className: "link-btn", textContent: "撤回" });
      twice(wd, "撤回", () => act({ id: it.id, action: "withdraw" }, () => (card.hidden = true)));
      tools.appendChild(wd);
      if (!admin) continue;

      const inv = el("button", { type: "button", className: "link-btn", textContent: it.invited ? "✓ 已邀请（取消）" : "标记已邀请" });
      inv.addEventListener("click", () =>
        act({ id: it.id, action: it.invited ? "uninvite" : "invite" }, () => {
          it.invited = it.invited ? 0 : 1;
          inv.textContent = it.invited ? "✓ 已邀请（取消）" : "标记已邀请";
        })
      );
      tools.appendChild(inv);

      if (it.status === "joined") {
        const un = el("button", { type: "button", className: "link-btn", textContent: "取消入驻标记（" + it.dojo + "）" });
        un.addEventListener("click", () => act({ id: it.id, action: "unjoin" }, () => (un.disabled = true)));
        tools.appendChild(un);
      } else {
        const slug = el("input", { placeholder: "道场代号，如 gongsheng", size: 16 });
        const ok = el("button", { type: "button", className: "link-btn", textContent: "标记已入驻" });
        ok.addEventListener("click", () => act({ id: it.id, action: "join", dojo: slug.value.trim() }, () => (ok.disabled = true)));
        tools.appendChild(el("span", { className: "rec-join" }, [slug, ok]));
      }

      const bl = el("button", { type: "button", className: "link-btn bad", textContent: "移除（对方要求）" });
      twice(bl, "移除（对方要求）", () => act({ id: it.id, action: "block" }, () => (card.hidden = true)));
      tools.appendChild(bl);
    }

    if (!admin) return;
    $("rec-admin").hidden = false;
    const box = $("rec-blocked");
    const blocked = d.items.filter((x) => x.status === "blocked");
    if (!blocked.length) return box.appendChild(el("p", { className: "meta", textContent: "目前没有应对方要求移除的条目。" }));
    box.appendChild(el("h3", { textContent: "已应对方要求移除（不能再推荐）" }));
    const ul = el("ul");
    for (const it of blocked) {
      const b = el("button", { type: "button", className: "link-btn", textContent: "解除（允许再推荐）" });
      b.addEventListener("click", () => act({ id: it.id, action: "unblock" }, () => li.remove()));
      const li = el("li", {}, [it.name + "（" + it.date + "） ", b]);
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }

  // ---------------- 推荐表单 ----------------
  const form = $("rec-form");
  if (!form) return;
  const result = $("rec-result");
  let image = "";

  // 填了链接就自动选平台
  form.link.addEventListener("change", () => {
    let host = "";
    try {
      host = new URL(form.link.value.trim()).hostname.toLowerCase();
    } catch (e) {
      return;
    }
    const opts = [...form.platform.options];
    const hit = opts.find((o) => o.dataset.host && new RegExp("(^|\\.)" + o.dataset.host).test(host));
    form.platform.value = hit ? hit.value : "网站";
  });

  // 图片：在浏览器里缩小并重新编码为 JPEG（顺便去掉拍摄地点等信息），最长边 1200 像素
  form.image.addEventListener("change", async () => {
    const file = form.image.files[0];
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((ok, bad) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => bad(new Error("无法读取这张图片，请换成 JPG 或 PNG"));
        i.src = url;
      });
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = el("canvas", { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      image = c.toDataURL("image/jpeg", 0.85);
      if (image.length > 2.6e6) throw new Error("图片处理后仍然太大，请换一张");
      $("rec-preview").querySelector("img").src = image;
      $("rec-preview").hidden = false;
      say("");
    } catch (err) {
      image = "";
      form.image.value = "";
      say(err.message, true);
    }
  });
  $("rec-img-clear").addEventListener("click", () => {
    image = "";
    form.image.value = "";
    $("rec-preview").hidden = true;
  });

  function box(kind, title, lines) {
    result.textContent = "";
    result.className = "notice result " + kind;
    result.appendChild(el("h2", { textContent: title }));
    lines.forEach((l) => result.appendChild(l));
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const p = (text) => el("p", { textContent: text });
  const a = (href, text) => el("p", {}, [el("a", { href, textContent: text })]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (!form.link.value.trim() && !form.account.value.trim()) return say("没有链接的，请填写账号名称或 ID，方便读者搜索", true);
    btn.disabled = true;
    btn.textContent = "AI 审核中，约 10–40 秒……";
    say("");
    result.hidden = true;
    try {
      const d = await api("recommend", {
        link: form.link.value,
        platform: form.platform.value,
        name: form.name.value,
        account: form.account.value,
        intro: form.intro.value,
        tags: [...form.querySelectorAll('input[name="tags"]:checked')].map((x) => x.value),
        image,
        hideName: form.sign.value === "hide",
        agree: form.agree.checked,
      });
      if (d.status === "rejected") {
        box("bad", "未通过审核", [p("AI 的理由：" + d.reason), p("推荐没有收录，也没有保存。可以修改后重新提交；如果你认为判断有误，可以写信到 report@dao10.org。")]);
      } else if (d.status === "duplicate") {
        box("ok", "已经有人推荐过了", [p("同一个链接或同名账号只收录一次。这一条在这里："), a(d.url, "查看这条推荐")]);
      } else {
        form.reset();
        image = "";
        $("rec-preview").hidden = true;
        box("ok", "已收录，谢谢推荐", [
          p("网站正在更新，大约 1–2 分钟后可以看到："),
          a(d.url, "查看这条推荐"),
          p("以后可以在“共道推荐”页面里撤回（登录后，你推荐的条目下方会出现“撤回”）。"),
        ]);
      }
    } catch (err) {
      say(err.offline ? "无法连接服务，请稍后再试" : err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "提交推荐";
    }
  });

  api("me")
    .then((d) => {
      if (!d.user) return ($("rec-guest").hidden = false);
      $("rec-name").textContent = d.user.displayName;
      form.hidden = false;
    })
    .catch(() => ($("rec-offline").hidden = false));
})();
