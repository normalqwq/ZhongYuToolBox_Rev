// ============================================================
// 管理后台接口（路由前缀 /admin-api）
//   POST   /admin-api/login   { password }           管理员登录（带防爆破）
//   GET    /admin-api/me                              检查管理员登录态
//   POST   /admin-api/logout                          退出登录
//   GET    /admin-api/users                           获取白名单
//   POST   /admin-api/users   { name }                添加用户名
//   DELETE /admin-api/users   { name } 或 { names: [] }  删除单个或批量用户名
//   POST   /admin-api/users/import  { text } 或 { names: [] }  批量导入
//   GET    /admin-api/users/export                     导出白名单（JSON）
//   GET    /admin-api/audit-log                        查看操作审计日志
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

const AUDIT_LOG_KEY = 'whitelist_audit_log'
const AUDIT_LOG_MAX = 200
const LOGIN_LOG_KEY = 'user_login_log'
const LOGIN_FAIL_KEY_PREFIX = 'admin_fail:'
const MAX_FAIL_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 分钟
const MAINTENANCE_KEY = 'maintenance_mode'

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

/** 取客户端真实 IP（Cloudflare 环境优先用 CF-Connecting-IP） */
function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

/** 读取登录失败计数 */
async function getLoginFail(env, ip) {
  try {
    const raw = await env.AUTH_KV.get(LOGIN_FAIL_KEY_PREFIX + ip)
    if (!raw) return { count: 0, lockedUntil: 0 }
    const obj = JSON.parse(raw)
    if (obj && typeof obj.count === 'number') return obj
    return { count: 0, lockedUntil: 0 }
  } catch {
    return { count: 0, lockedUntil: 0 }
  }
}

/** 写入登录失败计数 */
async function setLoginFail(env, ip, data) {
  try {
    await env.AUTH_KV.put(LOGIN_FAIL_KEY_PREFIX + ip, JSON.stringify(data), {
      expirationTtl: Math.ceil(LOCK_DURATION_MS / 1000) + 60
    })
  } catch {}
}

/** 清除登录失败计数（登录成功时调用） */
async function clearLoginFail(env, ip) {
  try {
    await env.AUTH_KV.delete(LOGIN_FAIL_KEY_PREFIX + ip)
  } catch {}
}

/** 追加一条审计日志 */
async function pushAuditLog(env, entry) {
  try {
    const raw = await env.AUTH_KV.get(AUDIT_LOG_KEY)
    let list = []
    if (raw) {
      try { list = JSON.parse(raw) } catch { list = [] }
      if (!Array.isArray(list)) list = []
    }
    list.unshift({ t: Date.now(), ...entry })
    if (list.length > AUDIT_LOG_MAX) list.length = AUDIT_LOG_MAX
    await env.AUTH_KV.put(AUDIT_LOG_KEY, JSON.stringify(list))
  } catch {}
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

  // ---------- 管理员登录（带防爆破） ----------
  if (path === '/login' && request.method === 'POST') {
    if (!env.ADMIN_PASSWORD || !env.AUTH_SECRET || !env.AUTH_KV) {
      return json(
        { ok: false, message: '后台尚未配置 ADMIN_PASSWORD / AUTH_SECRET / AUTH_KV，请先在 Cloudflare 中设置' },
        500
      )
    }
    const ip = getClientIp(request)
    const fail = await getLoginFail(env, ip)

    // 处于锁定期
    if (fail.lockedUntil && fail.lockedUntil > Date.now()) {
      const remain = Math.ceil((fail.lockedUntil - Date.now()) / 1000)
      return json(
        { ok: false, message: `登录失败次数过多，请 ${remain} 秒后再试`, locked: true, retryAfter: remain },
        429
      )
    }

    const { password } = await readJsonBody(request)
    if (!passwordOk(String(password || ''), env.ADMIN_PASSWORD)) {
      const nextCount = fail.count + 1
      const willLock = nextCount >= MAX_FAIL_ATTEMPTS
      const entry = {
        count: nextCount,
        lockedUntil: willLock ? Date.now() + LOCK_DURATION_MS : 0
      }
      await setLoginFail(env, ip, entry)
      const msg = willLock
        ? `密码错误次数过多，已锁定 ${Math.round(LOCK_DURATION_MS / 60000)} 分钟`
        : `管理员密码不正确（还剩 ${MAX_FAIL_ATTEMPTS - nextCount} 次机会）`
      return json({ ok: false, message: msg, locked: willLock }, 401)
    }

    // 登录成功：清除失败计数
    await clearLoginFail(env, ip)
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

  // ---------- 导出白名单 ----------
  if (path === '/users/export' && request.method === 'GET') {
    const users = await getWhitelist(env)
    return json({ ok: true, users, count: users.length })
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
    await pushAuditLog(env, { action: 'add', names: [userName] })
    return json({ ok: true, users: next })
  }

  // ---------- 批量导入用户名 ----------
  if (path === '/users/import' && request.method === 'POST') {
    const body = await readJsonBody(request)
    let inputNames = []
    if (body && Array.isArray(body.names)) {
      inputNames = body.names
    } else if (body && typeof body.text === 'string') {
      inputNames = body.text.split(/[\r\n,，;；\s]+/)
    }
    const cleaned = [...new Set(
      inputNames.map((s) => String(s || '').trim()).filter(Boolean)
    )]
    if (!cleaned.length) {
      return json({ ok: false, message: '没有检测到有效的用户名' }, 400)
    }
    const tooLong = cleaned.filter((n) => n.length > 64)
    if (tooLong.length) {
      return json({ ok: false, message: `有 ${tooLong.length} 个用户名超过 64 字符，请检查` }, 400)
    }
    const list = await getWhitelist(env)
    const existing = new Set(list)
    const toAdd = cleaned.filter((n) => !existing.has(n))
    const skipped = cleaned.length - toAdd.length
    const next = toAdd.length ? await setWhitelist(env, [...list, ...toAdd]) : list
    await pushAuditLog(env, {
      action: 'import',
      names: toAdd,
      added: toAdd.length,
      skipped
    })
    return json({
      ok: true,
      users: next,
      added: toAdd.length,
      skipped,
      total: next.length
    })
  }

  // ---------- 删除用户名（支持单个或批量） ----------
  if (path === '/users' && request.method === 'DELETE') {
    const body = await readJsonBody(request)
    const list = await getWhitelist(env)
    let toRemove = []
    if (body && Array.isArray(body.names)) {
      toRemove = body.names.map((s) => String(s || '').trim()).filter(Boolean)
    } else if (body && body.name) {
      toRemove = [String(body.name).trim()]
    }
    if (!toRemove.length) {
      return json({ ok: false, message: '请指定要删除的用户名' }, 400)
    }
    const removeSet = new Set(toRemove)
    const exists = toRemove.filter((n) => list.includes(n))
    if (!exists.length) {
      return json({ ok: false, message: '名单里没有这些用户名' }, 404)
    }
    const next = await setWhitelist(env, list.filter((u) => !removeSet.has(u)))
    await pushAuditLog(env, {
      action: toRemove.length > 1 ? 'batch_remove' : 'remove',
      names: exists
    })
    return json({ ok: true, users: next })
  }

  // ---------- 审计日志 ----------
  if (path === '/audit-log' && request.method === 'GET') {
    try {
      const raw = await env.AUTH_KV.get(AUDIT_LOG_KEY)
      const list = raw ? JSON.parse(raw) : []
      return json({ ok: true, logs: Array.isArray(list) ? list : [] })
    } catch {
      return json({ ok: true, logs: [] })
    }
  }

<<<<<<< Updated upstream
=======
  // ---------- 登录日志 ----------
  if (path === '/login-log' && request.method === 'GET') {
    try {
      const raw = await env.AUTH_KV.get(LOGIN_LOG_KEY)
      const list = raw ? JSON.parse(raw) : []
      return json({ ok: true, logs: Array.isArray(list) ? list : [] })
    } catch {
      return json({ ok: true, logs: [] })
    }
  }

>>>>>>> Stashed changes
  // ---------- 维护模式：读取状态 ----------
  if (path === '/maintenance' && request.method === 'GET') {
    try {
      const raw = await env.AUTH_KV.get(MAINTENANCE_KEY)
      const cfg = raw ? JSON.parse(raw) : null
      // 自动过期：定时维护到期后自动关闭
      if (cfg && cfg.until && cfg.until > 0 && cfg.until < Date.now()) {
        await env.AUTH_KV.delete(MAINTENANCE_KEY)
        return json({ ok: true, maintenance: null })
      }
      return json({ ok: true, maintenance: cfg || null })
    } catch {
      return json({ ok: true, maintenance: null })
    }
  }

  // ---------- 维护模式：开启 / 关闭 ----------
  if (path === '/maintenance' && (request.method === 'POST' || request.method === 'PUT')) {
    const body = await readJsonBody(request)
    const enable = body.enable !== false
    if (!enable) {
      await env.AUTH_KV.delete(MAINTENANCE_KEY)
      await pushAuditLog(env, { action: 'maintenance_off' })
      return json({ ok: true, maintenance: null })
    }
    // 开启：可选 duration（分钟），到期自动关闭
    let until = 0
    const duration = Number(body.duration) || 0
    if (duration > 0) until = Date.now() + duration * 60 * 1000
    const cfg = {
      message: String(body.message || '网站正在维护中，请稍后再来～').slice(0, 200),
      until,
      startedAt: Date.now(),
      startedBy: 'admin'
    }
    await env.AUTH_KV.put(MAINTENANCE_KEY, JSON.stringify(cfg))
    await pushAuditLog(env, {
      action: 'maintenance_on',
      names: [cfg.message],
      added: duration || 0
    })
    return json({ ok: true, maintenance: cfg })
  }

  return json({ ok: false, message: '未知的后台接口' }, 404)
}
