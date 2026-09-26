// 同源图片代理：解决 ezy-word2html-imgs.oss-cn-hangzhou.aliyuncs.com 未配置 CORS
// 导致前端 fetch(...).blob() 跨域读取被浏览器拦截（Failed to fetch）的问题。
//
// 路由：/imgproxy?url=<encodeURIComponent(真实图片URL)>
// 服务端 fetch 不受 CORS 限制，拉到图片后加上 Access-Control-Allow-Origin 返回。
//
// 安全：只允许白名单 host（阿里云 OSS / zyai.cc 资源域名），防 SSRF 滥用。

const ALLOWED_HOST_SUFFIXES = [
  '.aliyuncs.com',
  '.zyai.cc',
  '.zykj.org'
]

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400'
  }
}

export async function onRequest(context) {
  const { request } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const reqUrl = new URL(request.url)
  const target = reqUrl.searchParams.get('url')

  if (!target) {
    return new Response('missing "url" parameter', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders() }
    })
  }

  let parsed
  try {
    parsed = new URL(target)
  } catch (e) {
    return new Response('invalid url', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders() }
    })
  }

  // 仅允许 http/https + 白名单域名
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new Response('invalid protocol', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders() }
    })
  }
  const host = parsed.hostname.toLowerCase()
  const allowed = ALLOWED_HOST_SUFFIXES.some(
    (suf) => host === suf.slice(1) || host.endsWith(suf)
  )
  if (!allowed) {
    return new Response('host not allowed: ' + host, {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders() }
    })
  }

  // 统一升级 https，避免服务端拉取时的混合内容/明文问题
  const fetchTarget = target.replace(/^http:\/\//i, 'https://')

  let upstream
  try {
    upstream = await fetch(fetchTarget, {
      method: 'GET',
      headers: { Accept: 'image/*,*/*;q=0.8' },
      redirect: 'follow'
    })
  } catch (e) {
    return new Response('upstream fetch failed: ' + String(e), {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', ...corsHeaders() }
    })
  }

  const body = await upstream.arrayBuffer()
  const outHeaders = {
    'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
    'Cache-Control': 'public, max-age=3600',
    ...corsHeaders()
  }
  // 透传 Accept-Ranges 便于浏览器分段加载（可选）
  const ranges = upstream.headers.get('accept-ranges')
  if (ranges) outHeaders['Accept-Ranges'] = ranges

  return new Response(body, {
    status: upstream.status,
    headers: outHeaders
  })
}
