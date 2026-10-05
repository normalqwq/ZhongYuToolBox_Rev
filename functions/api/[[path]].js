import {
  getWhitelist,
  signToken,
  sessionCookie,
  USER_COOKIE,
  SESSION_MAX_AGE
} from '../_auth.js'

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

// ★ 用户登录日志：记录成功登录的用户名 + IP，存 KV，保留最近 500 条
const LOGIN_LOG_KEY = 'user_login_log';
async function pushLoginLog(env, userName, ip) {
  if (!env || !env.AUTH_KV || !userName) return;
  try {
    const raw = await env.AUTH_KV.get(LOGIN_LOG_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift({ t: Date.now(), u: userName, ip: ip || '' });
    if (list.length > 500) list.length = 500;
    await env.AUTH_KV.put(LOGIN_LOG_KEY, JSON.stringify(list));
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

/**
 * 专门处理登录接口的响应：
 * 1. 上游学校服务器验证账号密码通过（拿到 accessToken）后
 * 2. 再查 KV 白名单，不在名单内则拒绝
 * 3. 在名单内则下发 HttpOnly 签名 Cookie，之后中间件凭它放行 /api
 */
async function handleLoginResponse(resp, reqText, env, entry) {
  const text = await resp.text();
  const h = {
    'content-type': resp.headers.get('content-type') || 'application/json; charset=utf-8',
    ...cors()
  };

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return new Response(text, { status: resp.status, headers: h });
  }

  // 只有“密码正确、真的登录成功”才进入白名单校验，避免对外暴露名单
  const loginOk = resp.ok && data && data.result && data.result.accessToken;
  if (!loginOk) {
    return new Response(text, { status: resp.status, headers: h });
  }

  if (!env.AUTH_SECRET) {
    entry.结果 = '缺少 AUTH_SECRET 配置';
    return new Response(
      JSON.stringify({
        result: null,
        success: false,
        unAuthorizedRequest: false,
        error: { code: 9900, message: '服务器尚未配置访问密钥（AUTH_SECRET），请联系管理员', details: null }
      }),
      { status: 500, headers: h }
    );
  }

  // 从请求体里取用户名（与前端 loginApi 发送的字段一致）
  let userName = '';
  try {
    userName = String(JSON.parse(reqText || '{}').userName || '').trim();
  } catch {}

  const whitelist = await getWhitelist(env);
  entry.登录用户 = userName || '(取不到用户名)';
  entry.在白名单 = whitelist.includes(userName);

  if (!userName || !whitelist.includes(userName)) {
    return new Response(
      JSON.stringify({
        result: null,
        success: false,
        unAuthorizedRequest: false,
        error: {
          code: 9901,
          message: '这个账号还没有访问权限哦～本站仅对指定同学开放，请联系管理员把你的用户名加进名单',
          details: null
        }
      }),
      { status: 403, headers: h }
    );
  }

  // 通过：签发 30 天会话凭证
  const token = await signToken(
    { u: userName, e: Date.now() / 1000 + SESSION_MAX_AGE },
    env.AUTH_SECRET
  );
  h['set-cookie'] = sessionCookie(USER_COOKIE, token);
  entry.结果 = '登录成功，已下发访问凭证';
  await pushLoginLog(env, userName, entry.IP || '');
  return new Response(text, { status: resp.status, headers: h });
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
    info['白名单人数'] = (await getWhitelist(env)).length;
    return json(info);
  }

  const auth = request.headers.get('authorization');
  const entry = {
    时间: new Date().toISOString().slice(11, 19),
    路径: full,
    方法: request.method,
    IP: request.headers.get('CF-Connecting-IP') || '',
    带Authorization: auth ? auth.slice(0, 32) + '…' : '没有',
  };

  // 是否为登录请求（ABP 接口，上游路径仍为 /api/TokenAuth/Login）
  const isLogin = short === '/TokenAuth/Login';

  // 维护模式：登录请求直接拦截，不转发到上游
  if (isLogin && env.AUTH_KV) {
    try {
      const raw = await env.AUTH_KV.get('maintenance_mode');
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg) {
          if (cfg.until && cfg.until > 0 && cfg.until < Date.now()) {
            await env.AUTH_KV.delete('maintenance_mode');
          } else {
            entry.结果 = '维护模式拦截登录';
            push(entry);
            return new Response(JSON.stringify({
              result: null,
              success: false,
              unAuthorizedRequest: false,
              error: {
                code: 9902,
                message: cfg.message || '网站正在维护中，请稍后再来～',
                details: null
              }
            }), {
              status: 503,
              headers: { 'content-type': 'application/json; charset=utf-8', ...cors() }
            });
          }
        }
      }
    } catch {}
  }

  // 上游实际路径：ABP 框架接口（/api/services、/api/TokenAuth 等）保持 full；
  // 非 ABP 的独立接口（Question/View、special/、CloudNotes/）上游不带 /api 前缀，需用 short
  const NON_ABP = /^\/(Question|special|CloudNotes|SelfStudy)(\/|$)/;
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
  ['host', 'referer', 'origin', 'content-length', 'cookie'].forEach((k) => headers.delete(k));
  const init = { method: request.method, headers, redirect: 'follow' };
  // 登录接口需要把请求体留下来解析用户名；其余请求同样读成 arrayBuffer 转发
  let reqText = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const rawBody = await request.arrayBuffer();
    if (isLogin) reqText = new TextDecoder().decode(rawBody);
    init.body = rawBody;
  }

  let resp;
  try { resp = await fetch(target, init); }
  catch (e) {
    entry.结果 = '连不上：' + String(e);
    push(entry);
    return json({ __proxyError: '连不上服务器', 目标: target, 详情: String(e) });
  }

  // 登录响应单独走白名单校验 + 下发凭证
  if (isLogin) {
    const out = await handleLoginResponse(resp, reqText, env, entry);
    push(entry);
    return out;
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
