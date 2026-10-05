// ============================================================
// 全站中间件：给 /api 接口和 /imgproxy 图片代理加一道登录门
// 浏览器里改本地缓存、直接调接口等绕前端的做法都会被这里拦住。
// 同时承担全站维护模式：管理员在后台开启后，所有访客都会看到维护页。
// ============================================================
import { getCookie, verifyToken, USER_COOKIE, ADMIN_COOKIE } from './_auth.js'

const MAINTENANCE_KEY = 'maintenance_mode'

/** 需要登录态才能访问的路径前缀/精确路径 */
function isProtected(pathname) {
  if (pathname.startsWith('/api/')) return true
  if (pathname === '/imgproxy') return true
  return false
}

function unauthorized() {
  return new Response(
    JSON.stringify({
      result: null,
      success: false,
      unAuthorizedRequest: true,
      error: { code: 401, message: '未登录或登录已失效，请重新登录', details: null }
    }),
    {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  )
}

/** 返回维护页面（HTML） */
function maintenancePage(message) {
  const safe = String(message || '网站正在维护中，请稍后再来～')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>网站维护中</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
      'Microsoft YaHei', sans-serif;
    background: linear-gradient(160deg, #eef2ff 0%, #f8fafc 40%, #ecfeff 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e293b;
    padding: 24px;
  }
  .card {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(30, 41, 59, 0.12);
    padding: 48px 36px;
    max-width: 520px;
    text-align: center;
  }
  .icon {
    width: 72px; height: 72px; margin: 0 auto 20px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f59e0b, #ef4444);
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 36px; font-weight: 700;
    box-shadow: 0 10px 24px rgba(239, 68, 68, 0.32);
  }
  h1 { font-size: 24px; color: #dc2626; margin-bottom: 12px; }
  p { font-size: 15px; color: #475569; line-height: 1.7; word-break: break-word; }
  .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">!</div>
    <h1>网站正在维护中</h1>
    <p>${safe}</p>
    <div class="footer">维护完成后将自动恢复访问，请稍后再试。</div>
  </div>
</body>
</html>`
  return new Response(html, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'retry-after': '300'
    }
  })
}

/** 读取维护配置（含自动过期） */
async function getMaintenance(env) {
  if (!env || !env.AUTH_KV) return null
  try {
    const raw = await env.AUTH_KV.get(MAINTENANCE_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw)
    if (!cfg || cfg.enable === false) return null
    // 定时维护到期：自动清除
    if (cfg.until && cfg.until > 0 && cfg.until < Date.now()) {
      try { await env.AUTH_KV.delete(MAINTENANCE_KEY) } catch {}
      return null
    }
    return cfg
  } catch {
    return null
  }
}

export async function onRequest(context) {
  const { request, env, next } = context
  const url = new URL(request.url)
  const pathname = url.pathname

  // 管理后台接口 / 跨域预检：直接放行（管理员要能在维护期间继续操作后台）
  if (pathname.startsWith('/admin-api')) return next()
  if (pathname === '/admin' || pathname === '/admin.html') return next()
  if (request.method === 'OPTIONS') return next()

  // 全站维护模式：除管理员外，所有人都看到维护页
  const cfg = await getMaintenance(env)
  if (cfg) {
    // 已登录的管理员直接放行，便于在维护期间检查前台表现
    const adminToken = getCookie(request, ADMIN_COOKIE)
    const adminOk = env.AUTH_SECRET && await verifyToken(adminToken, env.AUTH_SECRET)
    if (!adminOk) return maintenancePage(cfg.message)
  }

  // 登录接口放行（functions/api/[[path]].js 内部会校验白名单并下发凭证）
  if (/^\/api\/TokenAuth\/Login(\/|$)/.test(pathname)) return next()

  if (isProtected(pathname)) {
    if (!env.AUTH_SECRET) {
      return new Response(
        JSON.stringify({ error: { message: '服务器尚未配置 AUTH_SECRET，请联系管理员' } }),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
      )
    }
    const token = getCookie(request, USER_COOKIE)
    const payload = await verifyToken(token, env.AUTH_SECRET)
    if (!payload) return unauthorized()
  }

  return next()
}
