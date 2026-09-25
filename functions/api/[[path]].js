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
  const full = url.pathname;                       // 例：/api/TokenAuth/Login
  const short = full.replace(/^\/api/, '');        // 例：/TokenAuth/Login（只用来判断内部端点）

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  if (short === '/__probe') {
    const code = (env && env.SCHOOL_CODE) || 'sxz';
    let info = { schoolCode: code };
    try {
      const r = await fetch(`${DISCOVERY}/api/discovery/${code}`, { headers: { Accept: 'application/json' } });
      info['查学校'] = { http状态: r.status, 返回: (await r.text()).slice(0, 400) };
    } catch (e) { info['查学校'] = { 失败: String(e) }; }
    info['服务器'] = await resolveUpstream(env);
    return json(info);
  }

  // ★ 关键修复：转发时保留完整的 /api 前缀
  let target;
  if (short.startsWith('/discovery/')) {
    target = DISCOVERY + full + url.search;        // /api/discovery/xxx → 官方网关
  } else {
    const up = await resolveUpstream(env);
    if (!up) return json({ __proxyError: '查不到学校服务器地址' });
    target = up + full + url.search;               // /api/xxx → 学校服务器，不再剥掉 /api
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
