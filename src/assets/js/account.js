// 账号页面：调用 dao10.org/api/*（同一域名，登录状态存在 HttpOnly Cookie 里，网页脚本读不到令牌）
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const msg = $("acc-msg");
  const say = (t, bad) => {
    msg.textContent = t || "";
    msg.classList.toggle("bad", !!bad);
  };
  let pendingUser = null; // 保存好恢复码后再显示的用户

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
      a.textContent = slug;
      li.appendChild(a);
      list.appendChild(li);
    });
    $("acc-dojos").hidden = !u.dojos.length;
    show("acc-user");
    announce(u);
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
