/**
 * 云笔记接口（复刻 index.js 中 loadNotes/searchNotes/noteGetAll/noteDownload 等）
 *
 * 改造说明：原版用 localStorage.apiBaseUrl（绝对 URL sxz.api.zykj.org）拼请求，
 * 触发 mixed-content + 跨域。现统一改为同源 /api/ 前缀，由 functions/api 反代转发。
 * special 路径（zyapi.loshop.com.cn 私有）已废，全部走 /CloudNotes/ 直连路径。
 */
import { aesEncrypt, aesDecrypt } from '@/utils/crypto'

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token') || ''}`
  }
}

export interface NoteItem {
  fileId: string
  fileName: string
  type: number
  createTime?: string
  updateTime?: string
}
export interface NoteResource {
  ossImageUrl: string
  pageIndex: number
  resourceType: number
}

/** 401 校验 */
function check401(status: number): void {
  if (status === 401) {
    throw new Error('身份失效，请重新登录')
  }
}

/** 按 parentId 获取某文件夹下的笔记/子文件夹（复刻 loadNotes） */
export async function getNotesByParentId(parentId = '0'): Promise<NoteItem[]> {
  const params = `parentid=${parentId}&isNoteNode=true`
  const url = `/api/CloudNotes/api/Notes/GetByParentId?${aesEncrypt(params)}`
  const res = await fetch(url, { headers: authHeaders() })
  check401(res.status)
  const json = await res.json()
  if (json.code !== 0) {
    throw new Error(json.msg || '获取笔记失败')
  }
  const data = JSON.parse(aesDecrypt(json.data))
  return (data.noteList || []) as NoteItem[]
}

/** 获取全部笔记（复刻 noteGetAll 的取数部分，仅保留 type 1/12） */
export async function getAllNotes(): Promise<NoteItem[]> {
  const res = await fetch(`/api/CloudNotes/api/Notes/GetAll`, {
    method: 'GET',
    headers: authHeaders()
  })
  check401(res.status)
  const json = await res.json()
  // 响应体的 data 字段为 AES 加密内容，需解密后才能取 noteList
  const data = JSON.parse(aesDecrypt(json.data))
  const list: NoteItem[] = data.noteList || []
  return list.filter((item) => item.type === 1 || item.type === 12)
}

/** 关键词搜索笔记（复刻 searchNotes，仅保留 type 1/12） */
export async function searchNotes(fileName: string): Promise<NoteItem[]> {
  const query = `fileName=${fileName}`
  const url = `/api/CloudNotes/api/Notes/Search?${aesEncrypt(query)}`
  const res = await fetch(url, { method: 'GET', headers: authHeaders() })
  check401(res.status)
  let data = await res.json()
  data = JSON.parse(aesDecrypt(data.data))
  const list: NoteItem[] = data.noteList || []
  return list.filter((item) => item.type === 1 || item.type === 12)
}

/** 按 fileId 获取笔记的图片资源列表（复刻 noteDownload 取数部分） */
export async function getNoteResources(fileId: string): Promise<NoteResource[]> {
  const url = `/api/CloudNotes/api/Resources/GetByFileId?${aesEncrypt('fileId=' + fileId)}`
  const res = await fetch(url, { method: 'GET', headers: authHeaders() })
  check401(res.status)
  const data = await res.json()
  return (JSON.parse(aesDecrypt(data.data)).resourceList || []) as NoteResource[]
}

/** 通过 special 路径获取全部资源用于打包下载（复刻 noteDownload2 取数部分） */
export async function getNoteResourcesForZip(fileId: string): Promise<NoteResource[]> {
  const url = `/api/CloudNotes/api/Resources/GetByFileId?${aesEncrypt('fileId=' + fileId)}`
  const res = await fetch(url, { method: 'GET', headers: authHeaders() })
  check401(res.status)
  const data = await res.json()
  return (JSON.parse(aesDecrypt(data.data)).resourceList || []) as NoteResource[]
}
