/**
 * 阿里云 OSS 直传封装（1:1 复刻 index.js 的 uploadFile / fetchOssBaseUrl）
 *
 * 改造说明：
 * - STS 凭证请求改为同源 /api/ 前缀，由 functions/api 反代转发
 * - ali-oss 客户端显式指定 https endpoint，避免内部默认 http
 */
import OSS from 'ali-oss'
import CryptoJS from 'crypto-js'

const V_MAP: Record<string, number> = {
  note_v2: 1, eval_v2: 2, quora_v2: 3, mistake_v2: 4, study_v2: 5,
  column_v2: 6, paper_v2: 7, revise_v2: 8, selection_v2: 9, manage_v2: 19
}
const G_MAP: Record<string, number> = { res: 1 }
const FR = 'res'
const FT = 2
const FE = ''
const FO = '0'

let ossBaseUrl = ''
export function getOssBaseUrl(): string {
  return ossBaseUrl
}
export function setOssBaseUrl(url: string): void {
  ossBaseUrl = url
}

function md5Upper(str: string): string {
  return CryptoJS.MD5(str).toString().toUpperCase()
}

export function generateNonce(): string {
  return (String(1e7) + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (
      (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))) as number
    ).toString(16)
  )
}

export interface StsCredential {
  region?: string
  accessKeyId: string
  accessKeySecret: string
  securityToken: string
  bucket?: string
  endpoint?: string
}

/** 请求 STS 临时凭证（同源 /api/ 前缀，由反代转发到 sxz.api.zykj.org） */
export async function generateStsToken(
  userId: string,
  fc: string,
  nonce: string
): Promise<StsCredential> {
  const ts = Date.now()
  const rawStr = `${userId}+${fc}+${FR}+${FT}+${FE}+${FO}+${nonce}+${ts}`
  const sign = md5Upper(rawStr)
  const token = localStorage.getItem('token')
  const resp = await fetch('/api/services/app/ObjectStorage/GenerateTokenV2Async', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fc: V_MAP[fc],
      fr: G_MAP[FR],
      ft: FT,
      fe: FE,
      fo: FO,
      nonce,
      ts,
      sign
    })
  })
  if (!resp.ok) {
    const errorText = await resp.text()
    throw new Error(`服务器响应错误(${resp.status}): ${errorText.substring(0, 100)}`)
  }
  const responseText = await resp.text()
  let data: any
  try {
    data = JSON.parse(responseText)
  } catch {
    throw new Error('服务器返回数据格式错误，请重新登录后再试')
  }
  if (!data.result) throw new Error('获取 token 失败: ' + JSON.stringify(data))
  return data.result as StsCredential
}

/** 拼接 OSS endpoint（强制 https） */
function buildOssEndpoint(cred: StsCredential): string {
  if (cred.endpoint) {
    return cred.endpoint.replace(/^http:/, 'https:').replace(/\/+$/, '')
  }
  const bucket = cred.bucket || 'ezy-sxz'
  const region = cred.region || 'oss-cn-hangzhou'
  return `https://${bucket}.${region}.aliyuncs.com`
}

export async function uploadFile(
  file: Blob | File,
  userId: string,
  fc: string,
  nonceInput = '',
  fileNameInput = ''
): Promise<string> {
  const nonce = nonceInput.trim() || generateNonce()
  const remoteFileName = fileNameInput.trim() || (file as File).name
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const result = await generateStsToken(userId, fc, nonce)
  const endpoint = buildOssEndpoint(result)
  const client = new OSS({
    region: result.region || 'oss-cn-hangzhou',
    accessKeyId: result.accessKeyId,
    accessKeySecret: result.accessKeySecret,
    stsToken: result.securityToken,
    bucket: result.bucket,
    endpoint: endpoint,
    secure: true
  })
  const remoteFile = `${fc}/${FR}/${userId}/${dateStr}/${nonce}/${remoteFileName}`
  await client.put(remoteFile, file as any)
  return endpoint + '/' + remoteFile
}

export async function fetchOssBaseUrl(userId: string): Promise<string> {
  if (ossBaseUrl) return ossBaseUrl
  const token = localStorage.getItem('token')
  if (!token) throw new Error('未登录')
  const nonce = generateNonce()
  const ts = Date.now()
  const rawStr = `${userId}+note_v2+res+1++0+${nonce}+${ts}`
  const sign = md5Upper(rawStr)
  const resp = await fetch('/api/services/app/ObjectStorage/GenerateTokenV2Async', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fc: 1, fr: 1, ft: 2, fe: '', fo: '0', nonce, ts, sign })
  })
  const data = await resp.json()
  if (!data.result) throw new Error('获取 OSS 配置失败')
  const endpoint = buildOssEndpoint(data.result)
  ossBaseUrl = endpoint + '/'
  return ossBaseUrl
}

export async function fetchUserId(): Promise<string> {
  const token = localStorage.getItem('token')
  if (!token) throw new Error('localStorage 中未找到 token')
  const resp = await fetch('/api/services/app/User/GetInfoAsync', {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Authorization: `Bearer ${token}`
    }
  })
  if (!resp.ok) throw new Error('请求用户信息失败: ' + resp.status)
  const data = await resp.json()
  if (data.result && data.result.id) return String(data.result.id)
  throw new Error('无法获取用户ID: ' + JSON.stringify(data))
}
