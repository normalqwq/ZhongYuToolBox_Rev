// ============================================================
// 访问控制公共工具：白名单读写（KV）、签名凭证（HMAC）、Cookie
// ============================================================

/** KV 中存储白名单的键名 */
export const WHITELIST_KEY = 'whitelist'
/** 普通用户会话 Cookie 名 */
export const USER_COOKIE = 'zy_auth'
/** 管理员会话 Cookie 名 */
export const ADMIN_COOKIE = 'zy_admin'
/** 会话有效期 30 天（秒） */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60

const enc = new TextEncoder()

/** base64url 编码（兼容中文，入参为字符串） */
function b64url(str) {
  // unescape(encodeURIComponent()) 把 UTF-8 字符串转成二进制串，再交给 btoa
  const bin = unescape(encodeURIComponent(str))
  return btoa(bin)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
/** base64url 解码（兼容中文） */
function b64urlDecode(input) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** 用 AUTH_SECRET 对 data 计算 HMAC-SHA256（十六进制） */
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 恒定时间比较，避免计时侧信道 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * 签发会话凭证：payload 里可放 { u: 用户名 } 或 { r: 'admin' }
 * 返回 base64url(payload).hex(hmac)
 */
export async function signToken(payload, secret) {
  const packed = b64url(JSON.stringify(payload))
  const sig = await hmacHex(secret, packed)
  return `${packed}.${sig}`
}

/**
 * 校验会话凭证：签名正确且未过期则返回 payload，否则返回 null
 */
export async function verifyToken(token, secret) {
  if (!token || !secret || typeof token !== 'string') return null
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const packed = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  let expected
  try {
    expected = await hmacHex(secret, packed)
  } catch {
    return null
  }
  if (!timingSafeEqual(sig, expected)) return null
  let payload
  try {
    payload = JSON.parse(b64urlDecode(packed))
  } catch {
    return null
  }
  if (!payload || typeof payload.e !== 'number') return null
  if (payload.e * 1000 <= Date.now()) return null
  return payload
}

/** 从请求中读取指定 Cookie 值 */
export function getCookie(request, name) {
  const header = request.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim())
    }
  }
  return ''
}

/** 组装 Set-Cookie 头（登录用） */
export function sessionCookie(name, token) {
  return (
    `${name}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; ` +
    `Path=/; Max-Age=${SESSION_MAX_AGE}`
  )
}

/** 组装清除 Cookie 的 Set-Cookie 头（登录用） */
export function clearCookie(name) {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

/** 读取白名单（用户名数组），KV 未初始化或解析失败时返回空数组 */
export async function getWhitelist(env) {
  try {
    const raw = await env.AUTH_KV.get(WHITELIST_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((s) => String(s).trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** 写入白名单 */
export async function setWhitelist(env, list) {
  const clean = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))]
  await env.AUTH_KV.put(WHITELIST_KEY, JSON.stringify(clean))
  return clean
}
