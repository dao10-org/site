// 投稿页面
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const msg = $("sub-msg");
  const say = (t, bad) => {
    msg.textContent = t || "";
    msg.classList.toggle("bad", !!bad);
  };
  const names = JSON.parse($("dojo-names").textContent || "{}");
  const form = $("sub-form");
  const result = $("sub-result");

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
    if (!res.ok) throw new Error(data.error || "出错了");
    return data;
  }

  // 结果框：用 DOM 拼装，不用 innerHTML，避免插入任何用户内容造成问题
  function box(kind, title, lines) {
    result.textContent = "";
    result.className = "notice result " + kind;
    const h = document.createElement("h2");
    h.textContent = title;
    result.appendChild(h);
    lines.forEach((l) => result.appendChild(l));
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const p = (text) => {
    const el = document.createElement("p");
    el.textContent = text;
    return el;
  };
  const link = (href, text) => {
    const el = document.createElement("p");
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    el.appendChild(a);
    return el;
  };

  form.querySelectorAll('input[name="sign"]').forEach((r) =>
    r.addEventListener("change", () => ($("sub-anon-tip").hidden = form.sign.value !== "anon"))
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const v = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    btn.textContent = "AI 审核中，约 10–40 秒……";
    say("");
    result.hidden = true;
    try {
      const d = await api("submit", {
        dojo: v.dojo,
        anonymous: v.sign === "anon",
        title: v.title,
        body: v.body,
        license: v.license,
        agree: !!v.agree,
      });
      if (d.status === "rejected") {
        box("bad", "未通过审核", [
          p("AI 的理由：" + d.reason),
          p("稿件没有发表，也没有保存。如果你认为判断有误，可以修改后重新提交，或者把稿件发到 report@dao10.org 申诉。"),
        ]);
      } else if (d.status === "published") {
        form.reset();
        box("ok", "已通过审核并发表", [
          p("网站正在更新，大约 1–2 分钟后可以打开："),
          link(d.url, "https://dao10.org" + d.url),
          p("以后可以在“账号”页的“我的投稿”里撤回。"),
        ]);
      } else if (d.status === "scheduled") {
        form.reset();
        const key = document.createElement("p");
        key.className = "recovery-code";
        key.textContent = d.manageKey;
        box("ok", "已通过审核，将匿名发表", [
          p("文章会在 24 小时内的随机时间发布，届时地址是："),
          link(d.url, "https://dao10.org" + d.url),
          p("下面是这篇文章的管理密钥，只显示这一次。平台不知道这篇文章是谁写的，撤回只能凭这个密钥。请抄下来保存，不要发到聊天软件里："),
          key,
        ]);
      }
    } catch (err) {
      say(err.offline ? "无法连接投稿服务，请稍后再试" : err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "提交审核";
    }
  });

  $("anon-withdraw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const d = await api("withdraw-anon", { key: f.key.value });
      f.reset();
      say("已撤回《" + d.title + "》。网站更新后（约 1–2 分钟）文章即消失。");
    } catch (err) {
      say(err.offline ? "无法连接投稿服务，请稍后再试" : err.message, true);
    }
  });

  api("me")
    .then((d) => {
      if (!d.user) return ($("sub-guest").hidden = false);
      $("sub-name").textContent = d.user.displayName;
      const sel = $("sub-dojo");
      (d.user.memberOf || []).forEach((slug) => {
        const o = document.createElement("option");
        o.value = slug;
        o.textContent = "道场：" + (names[slug] || slug);
        sel.appendChild(o);
      });
      if ((d.user.memberOf || []).length === 1) sel.value = d.user.memberOf[0];
      form.hidden = false;
    })
    .catch(() => ($("sub-offline").hidden = false));
})();
