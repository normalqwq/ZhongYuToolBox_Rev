// ============================================================
// 全站中间件：给 /api 接口和 /imgproxy 图片代理加一道登录门
// 浏览器里改本地缓存、直接调接口等绕前端的做法都会被这里拦住。
// ============================================================
import { getCookie, verifyToken, getOverviewWhitelist, USER_COOKIE } from './_auth.js'

/** 需要登录态才能访问的路径前缀/精确路径 */
function isProtected(pathname) {
  if (pathname.startsWith('/api/')) return true
  if (pathname === '/imgproxy') return true
  return false
}

/** 「考试概览 / 导出班级作答」接口：在已登录基础上再做二级白名单校验 */
function isOverviewApi(pathname) {
  return (
    pathname.startsWith('/api/services/app/LearningSituations/GetExamOverviewAsync') ||
    pathname.startsWith('/api/services/app/Exam/ExportObjectiveAnswersAsync')
  )
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

function forbidden() {
  return new Response(
    JSON.stringify({
      result: null,
      success: false,
      unAuthorizedRequest: false,
      error: { code: 403, message: '您没有查看考试概览/导出班级作答的权限，请联系管理员开通', details: null }
    }),
    {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  )
}

export async function onRequest(context) {
  const { request, env, next } = context
  const url = new URL(request.url)
  const pathname = url.pathname

  // 管理后台接口 / 跨域预检：直接放行
  if (pathname.startsWith('/admin-api')) return next()
  if (request.method === 'OPTIONS') return next()

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

    // 「考试概览」二级白名单校验：名单为空 = 不启用限制；非空则只有名单内用户可访问
    if (isOverviewApi(pathname)) {
      const overviewList = await getOverviewWhitelist(env)
      if (overviewList.length > 0 && !overviewList.includes(payload.u || '')) {
        return forbidden()
      }
    }
  }

  return next()
}
