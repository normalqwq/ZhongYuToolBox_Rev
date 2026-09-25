let cache = null;
const DISCOVERY = 'https://hagateway.zykj.org';

// ★ 请求日志：记录最近 40 条经过本反代的请求
let LOG = [];
function push(e) {
  try {
    LOG.unshift(e);
    if (LOG.length > 40) LOG.length = 40;
  } catch (err) {}
}

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
  const full = url.pathname;
  const short = full.replace(/^\/api/, '');

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  // 查看日志
  if (short === '/__log') return json({ 共: LOG.length, 最近请求: LOG });
  if (short === '/__clear') { LOG = []; return json({ ok: '已清空' }); }

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

  const auth = request.headers.get('authorization');
  const entry = {
    时间: new Date().toISOString().slice(11, 19),
    路径: full,
    方法: request.method,
    带Authorization: auth ? auth.slice(0, 32) + '…' : '没有',
  };

  // 上游实际路径：ABP 框架接口（/api/services、/api/TokenAuth 等）保持 full；
  // 非 ABP 的独立接口（Question/View、special/、CloudNotes/）上游不带 /api 前缀，需用 short
  const NON_ABP = /^\/(Question|special|CloudNotes)(\/|$)/;
  const upstreamPath = NON_ABP.test(short) ? short : full;

  let target;
  if (short.startsWith('/discovery/')) {
    target = DISCOVERY + full + url.search;
  } else {
    const up = await resolveUpstream(env);
    if (!up) { entry.结果 = '查不到服务器'; push(entry); return json({ __proxyError: '查不到学校服务器地址' }); }
    target = up + upstreamPath + url.search;
  }
  entry.转发到 = target;

  const headers = new Headers(request.headers);
  ['host', 'referer', 'origin', 'content-length'].forEach((k) => headers.delete(k));
  const init = { method: request.method, headers, redirect: 'follow' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();

  let resp;
  try { resp = await fetch(target, init); }
  catch (e) {
    entry.结果 = '连不上：' + String(e);
    push(entry);
    return json({ __proxyError: '连不上服务器', 目标: target, 详情: String(e) });
  }

  // 记下响应（只取文本前 300 字符，二进制会跳过）
  try {
    const c = resp.clone();
    const t = await c.text();
    entry.上游状态 = resp.status;
    entry.响应片段 = t.slice(0, 300);
    entry.是否含未登录报错 = t.indexOf('CurrentUserDidNotLogin') !== -1;
  } catch (e) { entry.响应片段 = '(读不到)'; }
  push(entry);

  const out = new Response(resp.body, { status: resp.status, headers: resp.headers });
  const h = cors();
  Object.keys(h).forEach((k) => out.headers.set(k, h[k]));
  return out;
}
