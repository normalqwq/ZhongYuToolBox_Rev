// ============================================================
// 管理后台接口（路由前缀 /admin-api）
//   POST   /admin-api/login   { password }   管理员登录
//   GET    /admin-api/me                     检查管理员登录态
//   POST   /admin-api/logout                 退出登录
//   GET    /admin-api/users                  获取白名单
//   POST   /admin-api/users   { name }       添加用户名
//   DELETE /admin-api/users   { name }       删除用户名
// ============================================================
import {
  getWhitelist,
  setWhitelist,
  signToken,
  verifyToken,
  getCookie,
  sessionCookie,
  clearCookie,
  ADMIN_COOKIE,
  SESSION_MAX_AGE
} from '../_auth.js'

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders }
  })
}

/** 恒定时间密码比较 */
function passwordOk(input, expected) {
  if (typeof input !== 'string' || typeof expected !== 'string') return false
  if (input.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/** 校验管理员 Cookie，失败返回 null */
async function requireAdmin(request, env) {
  if (!env.AUTH_SECRET) return null
  return verifyToken(getCookie(request, ADMIN_COOKIE), env.AUTH_SECRET)
}

async function readJsonBody(request) {
  try {
    return (await request.json()) || {}
  } catch {
    return {}
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/admin-api/, '') || '/'

  // ---------- 管理员登录 ----------
  if (path === '/login' && request.method === 'POST') {
    if (!env.ADMIN_PASSWORD || !env.AUTH_SECRET) {
      return json(
        { ok: false, message: '后台尚未配置 ADMIN_PASSWORD / AUTH_SECRET，请先在 Cloudflare 中设置' },
        500
      )
    }
    const { password } = await readJsonBody(request)
    if (!passwordOk(String(password || ''), env.ADMIN_PASSWORD)) {
      return json({ ok: false, message: '管理员密码不正确' }, 401)
    }
    const token = await signToken(
      { r: 'admin', e: Date.now() / 1000 + SESSION_MAX_AGE },
      env.AUTH_SECRET
    )
    return json(
      { ok: true },
      200,
      { 'set-cookie': sessionCookie(ADMIN_COOKIE, token) }
    )
  }

  // ---------- 检查登录态 ----------
  if (path === '/me' && request.method === 'GET') {
    const admin = await requireAdmin(request, env)
    return admin ? json({ ok: true }) : json({ ok: false }, 401)
  }

  // ---------- 退出登录 ----------
  if (path === '/logout' && request.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': clearCookie(ADMIN_COOKIE) })
  }

  // ---------- 以下接口都需要管理员身份 ----------
  const admin = await requireAdmin(request, env)
  if (!admin) return json({ ok: false, message: '请先登录管理员账号' }, 401)

  if (!env.AUTH_KV) {
    return json({ ok: false, message: '尚未绑定 KV（AUTH_KV），请在 Cloudflare 后台绑定' }, 500)
  }

  // ---------- 获取名单 ----------
  if (path === '/users' && request.method === 'GET') {
    return json({ ok: true, users: await getWhitelist(env) })
  }

  // ---------- 添加用户名 ----------
  if (path === '/users' && request.method === 'POST') {
    const { name } = await readJsonBody(request)
    const userName = String(name || '').trim()
    if (!userName) return json({ ok: false, message: '用户名不能为空' }, 400)
    if (userName.length > 64) return json({ ok: false, message: '用户名太长了' }, 400)
    const list = await getWhitelist(env)
    if (list.includes(userName)) {
      return json({ ok: false, message: '这个用户名已经在名单里了' }, 409)
    }
    const next = await setWhitelist(env, [...list, userName])
    return json({ ok: true, users: next })
  }

  // ---------- 删除用户名 ----------
  if (path === '/users' && request.method === 'DELETE') {
    const { name } = await readJsonBody(request)
    const userName = String(name || '').trim()
    const list = await getWhitelist(env)
    if (!list.includes(userName)) {
      return json({ ok: false, message: '名单里没有这个用户名' }, 404)
    }
    const next = await setWhitelist(env, list.filter((u) => u !== userName))
    return json({ ok: true, users: next })
  }

  return json({ ok: false, message: '未知的后台接口' }, 404)
}
