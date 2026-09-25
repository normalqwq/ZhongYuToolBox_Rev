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

async function loginTest(env, u, p) {
  const out = {};
  const up = await resolveUpstream(env);
  out['0_服务器'] = up;
  if (!up) { out.结论 = '查不到学校服务器'; return json(out); }

  let token = null;
  try {
    const r = await fetch(up + '/api/TokenAuth/Login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ userName: u, password: p, clientType: 1 }),
    });
    const txt = await r.text();
    out['1_登录'] = { http状态: r.status, 返回: txt.slice(0, 600) };
    try {
      const j = JSON.parse(txt);
      if (j && j.result && j.result.accessToken) token = j.result.accessToken;
    } catch (e) {}
  } catch (e) { out['1_登录'] = { 失败: String(e) }; }

  if (!token) {
    out.结论 = '第1步登录就没拿到 token，看「1_登录」返回';
    return json(out);
  }
  out['2_token前30位'] = token.slice(0, 30) + '...';

  const path = '/api/services/app/User/GetInfoAsync';
  const tries = [
    ['A_只带Authorization', { Authorization: 'Bearer ' + token }],
    ['B_加租户头', { Authorization: 'Bearer ' + token, 'Abp.TenantId': '1', AppName: 'WebClient', AppVersion: '0' }],
    ['C_带Id参数', { Authorization: 'Bearer ' + token }],
  ];

  for (const [name, hdrs] of tries) {
    try {
      const url = name === 'C_带Id参数' ? up + path + '?Id=0' : up + path;
      const r = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...hdrs } });
      const txt = await r.text();
      out[name] = { http状态: r.status, 返回: txt.slice(0, 400) };
    } catch (e) { out[name] = { 失败: String(e) }; }
  }

  out.结论 = '看 A/B/C 哪个 http状态 是 200';
  return json(out);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  if (path === '/__probe') {
    const code = (env && env.SCHOOL_CODE) || 'sxz';
    let info = { schoolCode: code };
    try {
      const r = await fetch(`${DISCOVERY}/api/discovery/${code}`, { headers: { Accept: 'application/json' } });
      info['查学校'] = { http状态: r.status, 返回: (await r.text()).slice(0, 400) };
    } catch (e) { info['查学校'] = { 失败: String(e) }; }
    info['服务器'] = await resolveUpstream(env);
    return json(info);
  }
  if (path === '/__test') {
    return await loginTest(env, url.searchParams.get('u') || '', url.searchParams.get('p') || '');
  }

  let target;
  if (path.startsWith('/discovery/')) {
    target = DISCOVERY + path + url.search;
  } else {
    const up = await resolveUpstream(env);
    if (!up) return json({ __proxyError: '查不到学校服务器地址' });
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
