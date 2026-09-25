// 反代原 zyapi.loshop.com.cn/navPage.html → sxz.school.zykj.org/navPage.html
// 该 SPA 内部加载的 CSS/JS/图片都挂在 web-alicdn.zyai.cc 上（协议相对 URL），
// 浏览器会自动用 https 直连 CDN，不需要代理。
// 所以这里只代理 navPage.html 这一个 HTML 文档即可。
//
// 路由：Cloudflare Pages 的 functions/navPage.html.js 会捕获 /navPage.html 请求
// （注意：文件名包含 .html 会被 CF 直接当作静态资源匹配，需要写成 functions/navPage.html.js
//  这样 CF 才会把它当 function 处理）

const UPSTREAM = 'http://sxz.school.zykj.org/navPage.html';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() });
  }

  let resp;
  try {
    resp = await fetch(UPSTREAM, {
      method: 'GET',
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ __proxyError: 'navPage 反代失败', target: UPSTREAM, err: String(e) }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', ...cors() } }
    );
  }

  // 读取 HTML 并修改：原页面 CSP 是 upgrade-insecure-requests，保留即可。
  // 这里我们让浏览器从同源加载 HTML，CDN 加载 JS/CSS，无需改 HTML 内容。
  const out = new Response(resp.body, { status: resp.status, headers: resp.headers });
  const h = cors();
  Object.keys(h).forEach((k) => out.headers.set(k, h[k]));
  // 重新声明 content-type，防止上游没有
  out.headers.set('content-type', 'text/html; charset=utf-8');
  return out;
}
