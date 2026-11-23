// gongsheng.dao10.org/verses/ → https://dao10.org/zh/dojos/gongsheng/verses/
const HOSTS = {
  "gongsheng.dao10.org": "/zh/dojos/gongsheng/",
  "way.dao10.org": "/zh/dojos/gongsheng/",
};

export default {
  fetch(request) {
    const url = new URL(request.url);
    const base = HOSTS[url.hostname];
    if (!base) return new Response("Not found", { status: 404 });
    const rest = url.pathname.replace(/^\/+/, "");
    return Response.redirect("https://dao10.org" + base + rest + url.search, 302);
  },
};
