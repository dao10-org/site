// 账号页面：调用 dao10.org/api/*（同一域名，登录状态存在 HttpOnly Cookie 里，网页脚本读不到令牌）
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const msg = $("acc-msg");
  const say = (t, bad) => {
    msg.textContent = t || "";
    msg.classList.toggle("bad", !!bad);
  };
  let pendingUser = null;
  const namesEl = $("dojo-names");
  const dojoNames = namesEl ? JSON.parse(namesEl.textContent || "{}") : {}; // 保存好恢复码后再显示的用户

  async function api(path, body) {
    const init = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }
      : { credentials: "same-origin" };
    const res = await fetch("/api/" + path, init);
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* 镜像站或离线：没有后台 */
    }
    if (!data) throw Object.assign(new Error("offline"), { offline: true });
    if (!res.ok) throw new Error(data.error || "出错了");
    return data;
  }

  const announce = (u) => document.dispatchEvent(new CustomEvent("gd-user", { detail: u }));

  function show(id) {
    ["acc-loading", "acc-guest", "acc-code", "acc-user"].forEach((x) => ($(x).hidden = x !== id));
  }

  function showUser(u) {
    $("acc-name").textContent = u.displayName;
    $("acc-username").textContent = u.username;
    $("acc-since").textContent = u.since;
    document.querySelector('[data-form="profile"] [name="displayName"]').value = u.displayName;
    const list = $("acc-dojo-list");
    list.textContent = "";
    u.dojos.forEach((slug) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "/zh/dojos/" + encodeURIComponent(slug) + "/";
      a.textContent = dojoNames[slug] || slug;
      const m = document.createElement("a");
      m.className = "tool-btn small";
      m.href = "/zh/dojo-admin/?d=" + encodeURIComponent(slug);
      m.textContent = "管理";
      li.append(a, m);
      list.appendChild(li);
    });
    $("acc-dojos").hidden = !u.dojos.length;
    $("acc-site-stats").hidden = u.role !== "admin";
    show("acc-user");
    loadSubs();
    announce(u);
  }

  // 我的投稿（署名文章）
  const STATUS = { published: "已发表", scheduled: "待发布", withdrawn: "已撤回" };
  async function loadSubs() {
    const ul = $("acc-subs");
    try {
      const { items } = await api("my-submissions");
      ul.textContent = "";
      if (!items.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "还没有投稿";
        ul.appendChild(li);
      }
      items.forEach((it) => {
        const li = document.createElement("li");
        const a = document.createElement(it.status === "withdrawn" ? "span" : "a");
        a.className = "post-title";
        a.textContent = it.title;
        if (it.status !== "withdrawn") a.href = it.url;
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = STATUS[it.status] + " · " + new Date(it.publish_at * 1000).toISOString().slice(0, 10) + " ";
        li.append(a, meta);
        if (it.status !== "withdrawn") {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "tool-btn small";
          b.textContent = "撤回";
          b.addEventListener("click", async () => {
            if (b.dataset.sure !== "1") {
              b.dataset.sure = "1";
              b.textContent = "确定撤回？再点一次";
              return;
            }
            b.disabled = true;
            try {
              await api("withdraw", { id: it.id });
              say("已撤回《" + it.title + "》，网站更新后（约 1–2 分钟）文章即消失");
              loadSubs();
            } catch (err) {
              say(err.message, true);
              b.disabled = false;
            }
          });
          meta.appendChild(b);
        }
        ul.appendChild(li);
      });
    } catch (e) {
      ul.textContent = "";
    }
  }

  function showCode(code, user) {
    $("acc-code-value").textContent = code;
    $("acc-code-ok").checked = false;
    $("acc-code-done").disabled = true;
    pendingUser = user;
    show("acc-code");
    announce(user);
  }

  // 登录 / 注册 / 忘记密码 切换
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      document.querySelectorAll("#acc-guest .acc-form").forEach((f) => (f.hidden = f.dataset.form !== t.dataset.tab));
      say("");
    })
  );

  const handlers = {
    async login(v) {
      showUser((await api("login", v)).user);
      say("已登录");
    },
    async register(v) {
      if (v.password !== v.password2) throw new Error("两次输入的密码不一样");
      delete v.password2;
      const d = await api("register", v);
      showCode(d.recoveryCode, d.user);
    },
    async recover(v) {
      const d = await api("recover", v);
      showCode(d.recoveryCode, d.user);
      say("新密码已设置。旧恢复码已作废，请保存新的。");
    },
    async profile(v) {
      showUser((await api("profile", v)).user);
      say("已保存");
    },
    async password(v, f) {
      await api("password", v);
      f.reset();
      say("密码已修改，其他设备已退出登录");
    },
    async delete(v) {
      await api("delete-account", v);
      show("acc-guest");
      say("账号已永久删除");
      announce(null);
    },
  };

  document.querySelectorAll(".acc-form").forEach((f) =>
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      say("");
      try {
        await handlers[f.dataset.form](Object.fromEntries(new FormData(f)), f);
      } catch (err) {
        say(err.offline ? "无法连接账号服务，请稍后再试" : err.message, true);
      } finally {
        btn.disabled = false;
      }
    })
  );

  $("acc-code-ok").addEventListener("change", (e) => ($("acc-code-done").disabled = !e.target.checked));
  $("acc-code-done").addEventListener("click", () => pendingUser && showUser(pendingUser));
  $("acc-code-copy").addEventListener("click", () =>
    navigator.clipboard.writeText($("acc-code-value").textContent).then(
      () => say("已复制"),
      () => say("请手动选中复制", true)
    )
  );
  $("acc-logout").addEventListener("click", async () => {
    try {
      await api("logout", {});
    } catch (e) {}
    show("acc-guest");
    say("已退出");
    announce(null);
  });

  api("me")
    .then((d) => (d.user ? showUser(d.user) : show("acc-guest")))
    .catch(() => {
      $("acc-loading").hidden = true;
      $("acc-offline").hidden = false;
    });
})();
