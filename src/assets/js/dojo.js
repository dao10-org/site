// 道场首页：站内留言表单；本道场管理员看到“管理本道场”入口
(function () {
  "use strict";
  const live = location.hostname === "dao10.org";

  // 管理入口：app.js 查询登录状态后发出 gd-me 事件
  const manage = document.getElementById("dojo-manage");
  const showManage = (u) => {
    if (manage && u && (u.dojos || []).includes(manage.dataset.slug)) manage.hidden = false;
  };
  if (window.gdUser) showManage(window.gdUser);
  document.addEventListener("gd-me", (e) => showManage(e.detail));

  // 站内留言
  const box = document.getElementById("dojo-relay");
  if (!box) return;
  const form = box.querySelector("form");
  if (!live) {
    form.hidden = true;
    box.querySelector(".relay-offline").hidden = false;
    return;
  }
  const msg = form.querySelector(".acc-msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    msg.classList.remove("bad");
    msg.textContent = "正在发送……";
    try {
      const res = await fetch("/api/dojo/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ slug: box.dataset.slug, body: form.elements.body.value, contact: form.elements.contact.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "发送失败，请稍后再试");
      form.reset();
      msg.textContent = "已送达道场。谢谢！";
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add("bad");
    } finally {
      btn.disabled = false;
    }
  });
})();
