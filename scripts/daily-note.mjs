/**
 * ============================================================
 * 每日早报 · 自动生成并上传到中育云笔记
 * ============================================================
 * 复用仓库现有「PDF 上传云笔记」链路的服务端版本：
 *   1. 用学校账号登录站点，换取 accessToken + 登录 Cookie
 *   2. 抓取指定 RSS 新闻源，作为 AI 的「当天素材」
 *   3. 调 DeepSeek（OpenAI 兼容接口）生成早报正文（HTML 片段）
 *   4. 用 Playwright 把正文渲染成 PDF（中文靠系统字体，无需嵌入字体）
 *   5. 复用 pdf2img.zyai.cc 把 PDF 转成逐页图片
 *   6. 取阿里云 OSS 的 STS 临时凭证，把模板文件 + 每页图片传上 OSS
 *   7. 调 CloudNotes 接口落库成一条云笔记
 *
 * 依赖的环境变量（GitHub Secrets）：
 *   ZY_BASE_URL        站点根地址，如 https://xxx.pages.dev（末尾不要带 /）  [必填]
 *   ZY_USERNAME        学校账号（需在站点白名单内）                          [必填]
 *   ZY_PASSWORD        学校账号密码                                          [必填]
 *   AI_API_KEY         DeepSeek 的 API Key                                   [必填]
 *   AI_BASE_URL        AI 接口根地址，默认 https://api.deepseek.com          [可选]
 *   AI_MODEL           模型名，默认 deepseek-chat                            [可选]
 *   AI_PROMPT          早报内容要求（覆盖 scripts/report-prompt.txt）         [可选]
 *   NEWS_SOURCES       新闻源 URL，多个用逗号或换行分隔                       [可选]
 *   NOTE_NAME_PREFIX   笔记名前缀，默认「每日早报」                            [可选]
 *   DRY_RUN            设为 1 时只生成内容与 PDF，不上传（方便调试）           [可选]
 * ============================================================
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import CryptoJS from 'crypto-js'
import OSS from 'ali-oss'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ---------- 环境变量 ----------
const BASE = req('ZY_BASE_URL').replace(/\/+$/, '')
const USERNAME = req('ZY_USERNAME')
const PASSWORD = req('ZY_PASSWORD')
const AI_API_KEY = req('AI_API_KEY')
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
const AI_MODEL = process.env.AI_MODEL || 'deepseek-chat'
const NOTE_NAME_PREFIX = process.env.NOTE_NAME_PREFIX || '每日早报'
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

const NEWS_SOURCES = (process.env.NEWS_SOURCES || [
  'https://www.ithome.com/rss/',
  'https://36kr.com/feed',
  'https://sspai.com/feed',
  'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml'
].join('\n'))
  .split(/[\n,]/)
  .map((s) => s.trim())
  .filter(Boolean)

const PROMPT = process.env.AI_PROMPT?.trim() || readPromptFile()

function req(name) {
  const v = process.env[name]
  if (!v) throw new Error(`缺少必需的环境变量：${name}`)
  return v.trim()
}

function readPromptFile() {
  try {
    return fs.readFileSync(path.join(__dirname, 'report-prompt.txt'), 'utf8').trim()
  } catch {
    return '请根据下面的新闻素材，整理一份简洁的中文每日早报。'
  }
}

function log(...a) {
  console.log('•', ...a)
}

// ---------- 日期工具 ----------
/** 北京时间 YYYY-MM-DD（用于笔记标题） */
function beijingDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date())
}
/** UTC YYYYMMDD（与前端链路一致：笔记 fileUrl 与 OSS 路径都用它） */
function utcCompactDate() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}
/** 资源时间戳，与前端 toLocaleString('zh-CN') 的结果保持一致：YYYY-MM-DD HH:mm:ss（北京时间） */
function resourceTimestamp() {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date())
  const g = (t) => parts.find((p) => p.type === t)?.value || '00'
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`
}

// ---------- 加密（复刻 src/config/index.ts + src/utils/crypto.ts） ----------
function generateAesKey() {
  const e = ":F0wKU!Qg3}UkbW+w[:9|D3-5h=:T;7t#_GZ4#G;~ZNSq{8;}QIP>'{q.lje"
  const t = new Date()
  const n = t.getFullYear()
  const r = t.getMonth() + 1
  const o = t.getDate()
  const i = 33 + o * r * 33
  const a = String.fromCharCode((i % 94) + 33)
  const s = e[o + r]
  const c = (n * r * o) % e.length
  const u = e.substring(c)
  const l = e.substring(0, c)
  const f = (u + l).substring(0, 14)
  return a + f + s
}
const ZY_AES_KEY = CryptoJS.enc.Utf8.parse(generateAesKey())
function aesEncrypt(data) {
  return CryptoJS.AES.encrypt(data, ZY_AES_KEY, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  }).toString()
}
function md5Upper(str) {
  return CryptoJS.MD5(str).toString().toUpperCase()
}

// ---------- 复刻 src/utils/oss.ts 的 nonce/uuid ----------
function generateNonce() {
  return (String(1e7) + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
    ).toString(16)
  )
}
function generateCustomFileId(prefix = 'h', length = 32) {
  const all = '0123456789abcdefghijklmnopqrstuvwxyz'
  for (;;) {
    let body = ''
    for (let i = 0; i < length; i++) body += all.charAt(Math.floor(Math.random() * all.length))
    if (/[g-z]/.test(body)) return prefix + body
  }
}
function generatePageHash() {
  return String(Date.now() + Math.floor(Math.random() * 1000))
}

// ---------- 带 Cookie 的请求（登录后所有 /api 调用都要带） ----------
let cookieJar = ''

function absorbSetCookie(res) {
  const raw = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : [])
  if (!raw.length) return
  const jar = {}
  for (const pair of cookieJar.split('; ').filter(Boolean)) {
    const i = pair.indexOf('=')
    if (i > 0) jar[pair.slice(0, i)] = pair.slice(i + 1)
  }
  for (const sc of raw) {
    const pair = String(sc).split(';')[0]
    const i = pair.indexOf('=')
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  }
  cookieJar = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (cookieJar) headers['Cookie'] = cookieJar
  const res = await fetch(url, { ...opts, headers })
  absorbSetCookie(res)
  return res
}

// ---------- 步骤 1：登录 ----------
let ACCESS_TOKEN = ''

async function login() {
  log('登录站点…')
  const res = await apiFetch(`${BASE}/api/TokenAuth/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ userName: USERNAME, password: PASSWORD, clientType: 1 })
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`登录返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
  if (!data?.result?.accessToken) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 200)
    throw new Error(`登录失败（HTTP ${res.status}）：${msg}`)
  }
  if (!cookieJar) throw new Error('登录成功但未拿到会话 Cookie，站点可能未配置 AUTH_SECRET')
  ACCESS_TOKEN = data.result.accessToken
  log('登录成功，已获取 accessToken 与会话 Cookie')
}

/** 从 JWT 里兜底解析 userId */
function userIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'))
    return payload.sub || payload.nameid || payload.userId || ''
  } catch {
    return ''
  }
}

async function getUserId() {
  try {
    const res = await apiFetch(`${BASE}/api/services/app/User/GetInfoAsync`, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, Accept: 'application/json' }
    })
    const data = await res.json()
    if (data?.result?.id) return String(data.result.id)
  } catch {}
  const fromToken = userIdFromToken(ACCESS_TOKEN)
  if (fromToken) return String(fromToken)
  throw new Error('无法获取用户 ID')
}

// ---------- 步骤 2：抓取新闻素材 ----------
function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
}
function stripTags(s) {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}
/** 清洗单条标题：先展开 CDATA → 去标签 → 解实体（顺序不能反，否则 CDATA 会被当标签删掉） */
function cleanTitle(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  s = stripTags(s)
  s = decodeEntities(s)
  return s.trim()
}
function parseFeed(xml) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || []
  const items = []
  for (const b of blocks) {
    const title = cleanTitle(b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
    if (title) items.push(title)
  }
  return items
}

async function fetchNews() {
  log(`抓取新闻素材（${NEWS_SOURCES.length} 个源）…`)
  const collected = []
  for (const src of NEWS_SOURCES) {
    try {
      const res = await fetch(src, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DailyNoteBot/1.0)', Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
        signal: AbortSignal.timeout(15000)
      })
      if (!res.ok) {
        log(`  × ${src} → HTTP ${res.status}`)
        continue
      }
      const xml = await res.text()
      const titles = parseFeed(xml).slice(0, 15)
      if (titles.length) {
        collected.push({ src, titles })
        log(`  ✓ ${src} → ${titles.length} 条`)
      } else {
        log(`  × ${src} → 未解析到条目`)
      }
    } catch (e) {
      log(`  × ${src} → ${e.message}`)
    }
  }
  return collected
}

// ---------- 步骤 3：AI 生成早报正文 ----------
const SYSTEM_PROMPT = [
  '你是一名严谨的中文早报编辑。你的输出会被直接排版打印成 PDF。',
  '输出格式（必须严格遵守）：',
  '1. 只输出干净的 HTML 片段，可用标签：h1、h2、p、ul、ol、li、strong、em、blockquote、br、hr；',
  '2. 不要输出 <html>、<head>、<body>、<script>、<style>、<a>，不要写行内 style；',
  '3. 不要使用 Markdown 语法（不要 #、不要 **、不要 ```），不要输出代码块；',
  '4. 开头用 <h1> 给出标题，例如「每日早报 · X月X日」；',
  '5. 直接输出 HTML，不要任何解释、寒暄或前后缀说明。'
].join('\n')

function sanitizeHtml(html) {
  let s = html.trim()
  s = s.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '')
  s = s.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<(html|head|body)[^>]*>/gi, '').replace(/<\/(html|head|body)>/gi, '')
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = s.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '')
  return s.trim()
}

/** 极简 Markdown → HTML 兜底（模型偶尔不按 HTML 输出时用） */
function markdownFallback(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let inList = false
  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      closeList()
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
      continue
    }
    const li = line.match(/^[-*]\s+(.*)$/)
    if (li) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inline(li[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}
function inline(t) {
  return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
}

async function generateReport(news) {
  log(`调用 AI 生成早报（${AI_MODEL}）…`)
  const newsText = news.length
    ? news.map((s) => `【来源：${s.src}】\n` + s.titles.map((t) => '- ' + t).join('\n')).join('\n\n')
    : '（本次未抓取到实时新闻素材，请基于你的常识生成一份通用的晨读提醒，避免编造具体日期与数字）'

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 1.0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${PROMPT}\n\n【今天的新闻素材】\n${newsText}` }
      ]
    }),
    signal: AbortSignal.timeout(120000)
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`AI 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    throw new Error(`AI 调用失败（HTTP ${res.status}）：${data?.error?.message || JSON.stringify(data).slice(0, 200)}`)
  }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 未返回内容：' + JSON.stringify(data).slice(0, 200))
  let html = content.trim()
  if (!/<\w+[^>]*>/.test(html)) html = markdownFallback(html)
  return sanitizeHtml(html)
}

// ---------- 步骤 4：HTML → PDF（Playwright，中文靠系统字体） ----------
function buildHtml(bodyHtml, dateLabel) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans CJK SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
         color: #1a1a1a; font-size: 13.5px; line-height: 1.75; margin: 0; }
  h1 { font-size: 22px; text-align: center; margin: 0 0 6px; letter-spacing: 1px; }
  .meta { text-align: center; color: #888; font-size: 12px; margin-bottom: 18px;
          padding-bottom: 12px; border-bottom: 2px solid #eee; }
  h2 { font-size: 16px; margin: 20px 0 8px; padding-left: 10px;
       border-left: 4px solid #4f46e5; color: #312e81; }
  h3 { font-size: 14.5px; margin: 14px 0 6px; color: #374151; }
  p { margin: 6px 0; text-align: justify; }
  ul, ol { margin: 6px 0 6px 4px; padding-left: 22px; }
  li { margin: 5px 0; text-align: justify; }
  blockquote { margin: 10px 0; padding: 8px 12px; background: #f8fafc;
               border-left: 3px solid #cbd5e1; color: #475569; }
  hr { border: none; border-top: 1px solid #eee; margin: 16px 0; }
</style></head><body>
<div class="meta">${dateLabel} · 自动生成</div>
${bodyHtml}
</body></html>`
}

async function htmlToPdf(html) {
  log('渲染 PDF…')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const buf = await page.pdf({ format: 'A4', printBackground: true })
    return Buffer.from(buf)
  } finally {
    await browser.close()
  }
}

// ---------- 步骤 5：PDF → 逐页图片（复用 pdf2img.zyai.cc） ----------
function normalizeImgUrl(raw) {
  let u = raw
  const m = u.match(/^https?:\/\/([a-z0-9-]+)\.alicdn\.zykj\.org\/(.*)$/i)
  if (m) u = `https://ezy-${m[1]}.oss-cn-hangzhou.aliyuncs.com/${m[2]}`
  if (/^https?:\/\//i.test(u)) return u.replace(/^http:\/\//i, 'https://')
  return 'https://pdf2img.zyai.cc/' + u.replace(/^\/+/, '')
}

async function pdfToImages(pdfBuf) {
  log('调用 pdf2img 转换图片…')
  const fd = new FormData()
  fd.append('file', new Blob([pdfBuf], { type: 'application/pdf' }), 'daily-report.pdf')
  const res = await fetch('https://pdf2img.zyai.cc/upload', { method: 'POST', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.imgPaths || !Array.isArray(data.imgPaths)) {
    throw new Error('PDF 转图片失败：' + JSON.stringify(data).slice(0, 200))
  }
  const images = []
  for (let i = 0; i < data.imgPaths.length; i++) {
    const url = normalizeImgUrl(data.imgPaths[i])
    let buf = null
    try {
      const r = await fetch(url)
      if (r.ok) buf = Buffer.from(await r.arrayBuffer())
    } catch {}
    if (!buf) {
      // 直连失败时，走站点的同源图片代理兜底
      const r = await apiFetch(`${BASE}/imgproxy?url=${encodeURIComponent(url)}`)
      if (!r.ok) throw new Error(`下载第 ${i + 1} 页图片失败（HTTP ${r.status}）`)
      buf = Buffer.from(await r.arrayBuffer())
    }
    images.push({ buf, contentType: detectImageType(buf) })
    log(`  第 ${i + 1}/${data.imgPaths.length} 页 ok`)
  }
  return images
}

function detectImageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  if (buf.length > 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  return 'application/octet-stream'
}

// ---------- 步骤 6：OSS 上传（复刻 src/utils/oss.ts） ----------
async function generateStsToken(userId, fc, nonce) {
  const ts = Date.now()
  const rawStr = `${userId}+${fc}+res+1+2++0+${nonce}+${ts}`
  const sign = md5Upper(rawStr)
  const res = await apiFetch(`${BASE}/api/services/app/ObjectStorage/GenerateTokenV2Async`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fc: 1, fr: 1, ft: 2, fe: '', fo: '0', nonce, ts, sign })
  })
  const data = await res.json()
  if (!data?.result) throw new Error('获取 OSS STS 凭证失败：' + JSON.stringify(data).slice(0, 200))
  return data.result
}

function buildOssUrl(cred, remoteFile) {
  const bucket = cred.bucket || 'ezy-sxz'
  const region = cred.region || 'oss-cn-hangzhou'
  return `https://${bucket}.${region}.aliyuncs.com/${remoteFile}`
}

async function uploadToOss(buf, userId, fc, nonceInput, fileNameInput, contentType) {
  const nonce = (nonceInput || '').trim() || generateNonce()
  const remoteFileName = (fileNameInput || '').trim()
  const cred = await generateStsToken(userId, fc, nonce)
  const client = new OSS({
    region: cred.region || 'oss-cn-hangzhou',
    accessKeyId: cred.accessKeyId,
    accessKeySecret: cred.accessKeySecret,
    stsToken: cred.securityToken,
    bucket: cred.bucket,
    secure: true
  })
  const remoteFile = `${fc}/res/${userId}/${utcCompactDate()}/${nonce}/${remoteFileName}`
  await client.put(remoteFile, buf, contentType ? { headers: { 'Content-Type': contentType } } : {})
  return buildOssUrl(cred, remoteFile)
}

// ---------- 步骤 7：落库成云笔记（复刻 src/api/pdfNote.ts） ----------
const TEMPLATE_UUID = 'a888b5fb-e65d-4611-a3af-1f80a0fb6ced'
const IMG_FILENAME =
  'B466246B6F67160E63431159941CD9A9screenCaptureb59d24b6-00fa-4f53-bc4f-1df255a5101a.webp'
const IMG_MD5 = '4126E637D965204140D4982A1B847283'

const TEMPLATE_FILES = [
  'page_router.bin',
  `${TEMPLATE_UUID}/059848e4-1971-47fb-9e47-517266cdef05_matrix.bin`,
  `${TEMPLATE_UUID}/a2b4fb47-3623-45be-9fe9-57fc62e66651_file.bin`,
  `${TEMPLATE_UUID}/e339e39b-64d9-4de0-bfaa-dace2a3f8e7d_command.bin`,
  `${TEMPLATE_UUID}/header.bin`,
  `${TEMPLATE_UUID}/router.bin`,
  `${TEMPLATE_UUID}/screenshot.png`,
  `${TEMPLATE_UUID}/snapshot.bin`
]

const TEMPLATE_RESOURCES = [
  { rel: 'page_router.bin', md5: 'C6FFAEB070ADBEC6B886BE63587CB0F8', resourceType: 1 },
  { rel: `${TEMPLATE_UUID}/059848e4-1971-47fb-9e47-517266cdef05_matrix.bin`, md5: '5D03C5A75809ED20D24C18388BB8AB63', resourceType: 1 },
  { rel: `${TEMPLATE_UUID}/a2b4fb47-3623-45be-9fe9-57fc62e66651_file.bin`, md5: '5924B6262213683E6A4A2AFD3E4A270B', resourceType: 1 },
  { rel: `${TEMPLATE_UUID}/e339e39b-64d9-4de0-bfaa-dace2a3f8e7d_command.bin`, md5: 'FEC4C90827E797E54126BB996BF0AF05', resourceType: 1 },
  { rel: `${TEMPLATE_UUID}/header.bin`, md5: 'A929A287A521818CA4E56A9E643866AE', resourceType: 1 },
  { rel: `${TEMPLATE_UUID}/router.bin`, md5: '053971527BD9F3D4E3F9B2A1A4D2023F', resourceType: 1 },
  { rel: `${TEMPLATE_UUID}/screenshot.png`, md5: '538BC7AC54289E9EAA758C50A006AE59', resourceType: 2 },
  { rel: `${TEMPLATE_UUID}/snapshot.bin`, md5: '9A26C2CA8A7C8731602497EA578C994F', resourceType: 1 }
]

function contentTypeByExt(f) {
  if (f.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

async function saveResourceList(list) {
  const res = await apiFetch(`${BASE}/api/CloudNotes/api/Resources/AddOrUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: aesEncrypt(JSON.stringify(list))
  })
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) throw new Error('保存资源失败：' + JSON.stringify(data).slice(0, 200))
}

async function saveNote(userId, customFileId, fileName) {
  const fileUrl = `https://ezy-sxz.oss-cn-hangzhou.aliyuncs.com/note_v2/res/${userId}/${utcCompactDate()}/${customFileId}/`
  const res = await apiFetch(`${BASE}/api/CloudNotes/api/Notes/AddOrUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: aesEncrypt(
      JSON.stringify({ fileId: customFileId, fileName, parentId: '0', type: '12', fileUrl })
    )
  })
  const data = await res.json().catch(() => ({}))
  if (data.code !== 0) throw new Error('保存笔记失败：' + JSON.stringify(data).slice(0, 200))
}

async function uploadAsNote(images, userId, noteName) {
  log('上传模板文件到 OSS…')
  const templates = {}
  for (const f of TEMPLATE_FILES) {
    templates[f] = fs.readFileSync(path.join(REPO_ROOT, 'public/example', f))
  }
  const customFileId = generateCustomFileId()
  const ossPageHash = generatePageHash()

  const testUrl = await uploadToOss(
    templates['page_router.bin'], userId, 'note_v2', customFileId,
    `${ossPageHash}/page_router.bin`, contentTypeByExt('page_router.bin')
  )
  const u = new URL(testUrl)
  const ossRoot = u.protocol + '//' + u.host + '/'
  delete templates['page_router.bin']
  for (const f of Object.keys(templates)) {
    if (f.includes('/')) {
      await uploadToOss(templates[f], userId, 'note_v2', customFileId, `${ossPageHash}/${f}`, contentTypeByExt(f))
    }
  }

  log(`上传 ${images.length} 页图片到 OSS…`)
  const dateCompact = utcCompactDate()
  const timestamp = resourceTimestamp()
  const ossBase = `${ossRoot}note_v2/res/${userId}/${dateCompact}/${customFileId}`
  const baseOss = `${ossBase}/${ossPageHash}`
  const resourceList = []

  for (let pageIndex = 0; pageIndex < images.length; pageIndex++) {
    const pageHash = generatePageHash()
    const pageBase = `/storage/emulated/0/Android/data/com.friday.cloudsnote/userNote/${userId}/note/${customFileId}/${pageHash}`
    await uploadToOss(images[pageIndex].buf, userId, 'note_v2', customFileId, `${pageHash}/${IMG_FILENAME}`, images[pageIndex].contentType)
    for (const tpl of TEMPLATE_RESOURCES) {
      resourceList.push({
        id: `${pageBase}/${tpl.rel}`,
        fileId: customFileId,
        pageName: pageBase,
        pageIndex,
        md5: tpl.md5,
        resourceType: tpl.resourceType,
        ossImageUrl: `${baseOss}/${tpl.rel}`,
        createTimeStamp: timestamp,
        updateTimeStamp: timestamp,
        toBeUploaded: false,
        wasDeleted: false
      })
    }
    resourceList.push({
      id: `${pageBase}/res/image/${IMG_FILENAME}`,
      fileId: customFileId,
      pageName: pageBase,
      pageIndex,
      md5: IMG_MD5,
      resourceType: pageIndex,
      ossImageUrl: `${ossBase}/${pageHash}/${IMG_FILENAME}`,
      createTimeStamp: timestamp,
      updateTimeStamp: timestamp,
      toBeUploaded: false,
      wasDeleted: false
    })
    log(`  第 ${pageIndex + 1}/${images.length} 页已上传`)
  }

  log('保存资源列表…')
  await saveResourceList(resourceList)
  log('保存笔记…')
  await saveNote(userId, customFileId, noteName)
}

// ---------- 主流程 ----------
async function main() {
  const dateLabel = beijingDate()
  const dateCn = dateLabel.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${+m}月${+d}日`)
  const noteName = `${NOTE_NAME_PREFIX} · ${dateLabel}`
  log(`开始生成「${noteName}」${DRY_RUN ? '（DRY_RUN 模式，不上传）' : ''}`)

  await login()
  const userId = await getUserId()
  log('用户 ID：' + userId)

  const news = await fetchNews()
  const bodyHtml = await generateReport(news)

  fs.mkdirSync(path.join(REPO_ROOT, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(REPO_ROOT, 'tmp', 'daily-report.html'), buildHtml(bodyHtml, dateCn), 'utf8')

  const pdfBuf = await htmlToPdf(buildHtml(bodyHtml, dateCn))
  fs.writeFileSync(path.join(REPO_ROOT, 'tmp', 'daily-report.pdf'), pdfBuf)
  log(`PDF 生成完成（${(pdfBuf.length / 1024).toFixed(1)} KB）`)

  if (DRY_RUN) {
    log('DRY_RUN：跳过转图与上传，产物在 tmp/ 目录')
    return
  }

  const images = await pdfToImages(pdfBuf)
  await uploadAsNote(images, userId, noteName)
  log(`✅ 已上传到云笔记：「${noteName}」（${images.length} 页）`)
}

main().catch((e) => {
  console.error('❌ 失败：', e?.message || e)
  process.exit(1)
})
