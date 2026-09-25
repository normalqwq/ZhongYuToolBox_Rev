let cache = null;
const DISCOVERY = 'https://hagateway.zykj.org';

async function resolveUpstream(env) {
  if (env && env.UPSTREAM) return env.UPSTREAM;
  if (cache && Date.now() - cache.t < 3600000) return cache.v;
  const code = (env && env.SCHOOL_CODE) || 'sxz';
  try {
    const r = await fetch(`${DISCOVERY}/api/discovery/${code}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.server) { cache = { v: j.server, t: Date.now() }; return j.server; }
  } catch (e) {}
  return null;
}

async function probe(env) {
  const code = (env && env.SCHOOL_CODE) || 'sxz';
  const info = { schoolCode: code };
  let upstream = null;
  try {
    const r = await fetch(`${DISCOVERY}/api/discovery/${code}`, { headers: { Accept: 'application/json' } });
    const txt = await r.text();
    info['步骤1_查学校地址'] = { http状态: r.status, 返回: txt.slice(0, 400) };
    try { upstream = JSON.parse(txt).server; } catch (e) {}
  } catch (e) { info['步骤1_查学校地址'] = { 失败: String(e) }; }
  upstream = (env && env.UPSTREAM) || upstream;
  info['最终使用的服务器'] = upstream;
  if (upstream) {
    try {
      const r = await fetch(upstream + '/api/TokenAuth/Login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: '__probe__', password: '__probe__', clientType: 1 }),
      });
      const txt = await r.text();
      info['步骤2_连学校服务器'] = { http状态: r.status, 返回: txt.slice(0, 400) };
      info.结论 = (r.status === 200 || r.status === 500)
        ? 'OK 链路通了，去网站登录试试'
        : '服务器有回应但状态异常，看返回内容';
    } catch (e) {
      info['步骤2_连学校服务器'] = { 失败: String(e) };
      info.结论 = 'Cloudflare 连不上学校服务器，此路不通';
    }
  } else { info.结论 = '查不到学校地址，去 Cloudflare 环境变量手动加 UPSTREAM'; }
  return json(info);
}

function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors() },
  });
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (path === '/__probe') return await probe(env);

  let target;
  if (path.startsWith('/discovery/')) {
    target = DISCOVERY + path + url.search;
  } else {
    const up = await resolveUpstream(env);
    if (!up) return json({ __proxyError: '查不到学校服务器地址', 提示: '打开 /api/__probe 看诊断' });
    target = up + path + url.search;
  }

  const headers = new Headers(request.headers);
  ['host', 'referer', 'origin', 'content-length'].forEach((k) => headers.delete(k));
  const init = { method: request.method, headers, redirect: 'follow' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();

  let resp;
  try { resp = await fetch(target, init); }
  catch (e) { return json({ __proxyError: '连不上服务器', 目标: target, 详情: String(e) }); }

  const out = new Response(resp.body, { status: resp.status, headers: resp.headers });
  const h = cors();
  Object.keys(h).forEach((k) => out.headers.set(k, h[k]));
  return out;
}
