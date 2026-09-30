/**
 * 资源代理工具（复刻旧 index.js window.proxyUrl / proxyImgSrc / detectLocalProxy）
 * 中育资源默认走远端代理 zytbdownloadagent.loshop.com.cn，
 * 若本机运行 tbHelper 加速插件（127.0.0.1:5005）则切换到本地代理。
 *
 * 同时提供全局轮询 startProxyPolling / stopProxyPolling / getProxyBaseUrl（供 AppLayout 使用）。
 */
import { PROXY_REMOTE, PROXY_LOCAL, PROXY_LOCAL_PING } from '@/config'
/** 当前生效的代理基地址（被 proxyUrl / proxyImgSrc / getProxyBaseUrl 共用） */
let proxyBaseUrl: string = PROXY_REMOTE
/**
 * alicdn 旧域名（sxz.alicdn.zykj.org）已不可用：
 * - https 证书失效（SSL 握手失败）
 * - http 在 https 页面被 mixed-content 拦截
 * 同一文件在 OSS 公共读桶中存在且可访问，统一换域名。
 */
function replaceAlicdnHost(url: string): string {
  const m = url.match(/^https?:\/\/([a-z0-9-]+)\.alicdn\.zykj\.org\/(.*)$/i)
  if (m) return `https://ezy-${m[1]}.oss-cn-hangzhou.aliyuncs.com/${m[2]}`
  return url
}
/** 拼接资源代理地址（视频/图片等浏览器直连场景，无需 CORS） */
export function proxyUrl(url: string): string {
  if (!url) return url
  // alicdn 旧域名换 OSS 公共读域名
  if (/^https?:\/\/[a-z0-9-]+\.alicdn\.zykj\.org\//i.test(url)) {
    return replaceAlicdnHost(url)
  }
  // 已是绝对 URL（http/https）原样返回，不走已死的下载代理
  if (/^https?:\/\//i.test(url)) return url
  // 相对路径拼前缀
  return proxyBaseUrl.endsWith('/') ? proxyBaseUrl + url : proxyBaseUrl + '/' + url
}
/** imgproxy 白名单后缀（与 functions/imgproxy.js 保持一致） */
const IMGPROXY_ALLOWED = ['.aliyuncs.com', '.zyai.cc', '.zykj.org']
/**
 * 需要 fetch 读取内容时的 URL（PDF 预览/下载/PPT 等）。
 * OSS 未配置 CORS 头，直接 fetch 会被浏览器拦截（Failed to fetch），
 * 走同源 /imgproxy 由服务端代拉并补 CORS 头。
 */
export function proxyFetchUrl(url: string): string {
  const u = proxyUrl(url)
  if (!/^https?:\/\//i.test(u)) return u
  try {
    const host = new URL(u).hostname.toLowerCase()
    const allowed = IMGPROXY_ALLOWED.some(
      (suf) => host === suf.slice(1) || host.endsWith(suf)
    )
    if (allowed) return '/imgproxy?url=' + encodeURIComponent(u)
  } catch {
    /* URL 解析失败则原样返回 */
  }
  return u
}
/** 图片代理：alicdn 源直接换 OSS 域名，其余走代理 */
export function proxyImgSrc(url: string): string {
  if (!url || typeof url !== 'string') return url
  // alicdn 旧域名换 OSS 公共读域名（http/https 都处理）
  if (/^https?:\/\/[a-z0-9-]+\.alicdn\.zykj\.org\//i.test(url)) {
    return replaceAlicdnHost(url)
  }
  // 已是绝对 URL（含 OSS 直连）原样返回
  if (/^https?:\/\//i.test(url)) return url
  return proxyUrl(url)
}
/** 返回当前代理基地址 */
export function getProxyBaseUrl(): string {
  return proxyBaseUrl
}
type ProxyChangeCb = (localOk: boolean, isWindows: boolean) => void
let pollingTimer: number | null = null
let lastLocalOk: boolean | null = null
function isWin(): boolean {
  return navigator.userAgent.indexOf('Windows') !== -1
}
async function pingLocalProxy(): Promise<boolean> {
  try {
    const resp = await fetch(PROXY_LOCAL_PING, { method: 'GET', mode: 'cors' })
    return resp.ok
  } catch {
    return false
  }
}
/** 全局轮询探测本地加速插件（供 AppLayout 在启动时调用） */
export function startProxyPolling(onChange: ProxyChangeCb): void {
  stopProxyPolling()
  const tick = async () => {
    const localOk = await pingLocalProxy()
    proxyBaseUrl = localOk ? PROXY_LOCAL : PROXY_REMOTE
    if (lastLocalOk !== localOk) {
      lastLocalOk = localOk
      onChange(localOk, isWin())
    }
  }
  tick()
  pollingTimer = window.setInterval(tick, 15000)
}
export function stopProxyPolling(): void {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer)
    pollingTimer = null
  }
}
/** 一次性探测本地加速插件（供页面级使用），含 toast 提示，并更新 proxyBaseUrl */
export async function detectLocalProxy(): Promise<void> {
  const localOk = await pingLocalProxy()
  proxyBaseUrl = localOk ? PROXY_LOCAL : PROXY_REMOTE
  if (lastLocalOk === localOk) return
  lastLocalOk = localOk
  const windows = isWin()
  if (localOk) {
    toast('本地加速服务已启用', '', 3000)
  } else if (windows) {
    toast(
      '加速插件未检测到',
      '检测到您使用的是 Windows 系统，建议下载并运行加速插件以提升资源加载速度。不使用加速插件不会影响使用。',
      0,
      '<a href="https://wumama.lanzouw.com/iG92334tbeeb" target="_blank" rel="noopener" style="color:#fff;text-decoration:none;background:#007bff;padding:6px 12px;border-radius:4px;">下载 tbHelperInstaller.exe</a>'
    )
  }
}
function toast(title: string, message: string, autoCloseMs: number, btnHtml = '') {
  const id = 'proxyToast'
  if (document.getElementById(id)) return
  const div = document.createElement('div')
  div.id = id
  div.style.cssText =
    'position:fixed;bottom:32px;right:32px;z-index:9999;max-width:400px;background:#333;color:#fff;padding:16px 24px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);opacity:0.95;font-size:14px;line-height:1.4;'
  div.innerHTML = `
    <div style="font-weight:bold;margin-bottom:8px;">${title}</div>
    ${message ? `<div style="margin-bottom:12px;">${message}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${btnHtml}
      <button style="padding:6px 12px;border:none;border-radius:4px;background:#555;color:#fff;cursor:pointer;">关闭</button>
    </div>`
  div.querySelector('button')!.addEventListener('click', () => div.remove())
  document.body.appendChild(div)
  if (autoCloseMs > 0) {
    setTimeout(() => {
      const t = document.getElementById(id)
      if (t) t.remove()
    }, autoCloseMs)
  }
}
