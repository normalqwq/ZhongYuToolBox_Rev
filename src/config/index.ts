/**
 * 统一配置中心（强制版：忽略 localStorage，一律走同源反代）
 */

const ls = window.localStorage

// 强制空字符串，不读 localStorage
export const API_BASE_URL: string = ''

// 强制空字符串
export const API_BASE_BASE_URL: string = ''

export const SHARE_SERVER: string =
  ls.getItem('shareServer') || 'https://zytbshareapi.loshop.com.cn'

export const PROXY_REMOTE = 'https://zytbdownloadagent.loshop.com.cn/download/'
export const PROXY_LOCAL = 'http://127.0.0.1:5005/proxy/'
export const PROXY_LOCAL_PING = 'http://127.0.0.1:5005/proxy/ping'

export const LINSPIRER = {
  KEY: '1191ADF18489D8DA',
  IV: '5E9B755A8B674394',
  API_BASE: 'https://zytb-linspirer-api.loshop.com.cn',
  API: 'https://zytb-linspirer-api.loshop.com.cn/public-interface.php',
  CLIENT_VERSION: 'zhongyukejiao_hem_6.10.004.6',
  FIXED_UUID: '40E06F51-30D0-D6AD-7F7D-008AD0ADC570'
}

export function generateAesKey(): string {
  const e = ':F0wKU!Qg3}UkbW+w[:9|D3-5h=:T;7t#_GZ4#G;~ZNSq{8;}QIP>\'{q.lje'
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

export interface SchoolOption {
  value: string
  label: string
}

export const SCHOOLS: SchoolOption[] = [
  { value: 'sxz', label: '省锡中' },
  { value: 'other', label: '其它学校' }
]

export const SUBJECTS: Array<[number, string]> = [
  [4, '语文'],
  [5, '数学'],
  [6, '外语'],
  [7, '物理'],
  [8, '化学'],
  [9, '生物'],
  [10, '政治'],
  [11, '历史'],
  [12, '地理'],
  [13, '全科专用（级部发布）'],
  [14, '信息技术'],
  [15, '通用技术'],
  [24, '体育与健康'],
  [34, '技术'],
  [35, '艺术'],
  [41, '研创大任务'],
  [42, '级部管理'],
  [53, '家务劳动'],
  [66, '调查问卷']
]

export const IFRAME_BASE = ''

export const OSS_PREFIXES: string[] = [
  'note_v2',
  'eval_v2',
  'quora_v2',
  'mistake_v2',
  'study_v2',
  'column_v2',
  'paper_v2',
  'revise_v2',
  'selection_v2',
  'manage_v2'
]
