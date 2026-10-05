/**
 * 全局搜索：聚合云笔记、随身答、错题本的关键词搜索结果。
 * 各模块独立 try/catch，一个失败不影响其他模块。
 */
import { searchNotes, type NoteItem } from '@/api/note'
import { getSessions, type QuoraSession } from '@/api/quora'
import { getMyMistakeBooks, searchMistakes } from '@/api/mistake'

export type SearchModule = 'note' | 'quora' | 'mistake'

export interface GlobalSearchResult {
  type: SearchModule
  typeLabel: string
  /** 主标题（展示用） */
  title: string
  /** 副标题/摘要（可选） */
  subtitle?: string
  /** 跳转目标 */
  route: { name: string; params?: Record<string, any> }
}

/** 每个模块最多返回的结果数，避免下拉过长 */
const PER_MODULE_LIMIT = 5

/* -------------------- 各模块搜索 -------------------- */

async function searchNotesModule(keyword: string): Promise<GlobalSearchResult[]> {
  const list: NoteItem[] = await searchNotes(keyword)
  return list.slice(0, PER_MODULE_LIMIT).map((item) => ({
    type: 'note',
    typeLabel: '云笔记',
    title: item.fileName || '未命名笔记',
    route: { name: 'note-detail', params: { fileId: item.fileId } }
  }))
}

async function searchQuoraModule(keyword: string): Promise<GlobalSearchResult[]> {
  const list: QuoraSession[] = await getSessions({
    keyword,
    catalogId: 0,
    topicId: 0,
    orderBy: 0,
    skip: 0,
    take: PER_MODULE_LIMIT,
    updateTime: { start: '', end: '' },
    joinTime: { start: '', end: '' },
    justWatch: [1, 2, 3, 4]
  })
  return list.slice(0, PER_MODULE_LIMIT).map((s) => ({
    type: 'quora',
    typeLabel: '随身答',
    title: s.summary || s.snapshot || '随身答对话',
    subtitle: s.askUserName ? `提问者：${s.askUserName}` : undefined,
    route: { name: 'quora-detail', params: { sessionId: s.id } }
  }))
}

async function searchMistakeModule(keyword: string): Promise<GlobalSearchResult[]> {
  const books = await getMyMistakeBooks()
  const results: GlobalSearchResult[] = []
  const kw = keyword.toLowerCase()
  for (const book of books) {
    if (results.length >= PER_MODULE_LIMIT) break
    const res = await searchMistakes(book.id)
    const items = res.items || []
    for (const item of items) {
      if (results.length >= PER_MODULE_LIMIT) break
      const haystack = `${item.source || ''} ${item.stemShoot || ''}`.toLowerCase()
      if (haystack.includes(kw)) {
        results.push({
          type: 'mistake',
          typeLabel: '错题本',
          title: item.source || item.stemShoot?.slice(0, 40) || '错题',
          subtitle: item.stemShoot ? item.stemShoot.slice(0, 60) : undefined,
          route: { name: 'mistake-detail', params: { itemId: item.id } }
        })
      }
    }
  }
  return results
}

/* -------------------- 聚合入口 -------------------- */

const MODULES: { key: SearchModule; label: string; fn: (kw: string) => Promise<GlobalSearchResult[]> }[] = [
  { key: 'note', label: '云笔记', fn: searchNotesModule },
  { key: 'quora', label: '随身答', fn: searchQuoraModule },
  { key: 'mistake', label: '错题本', fn: searchMistakeModule }
]

/**
 * 全局搜索，并发调用各模块，某模块失败时静默跳过。
 * 返回结果按模块分组（笔记 → 随身答 → 错题本）。
 */
export async function globalSearch(keyword: string): Promise<GlobalSearchResult[]> {
  const kw = keyword.trim()
  if (!kw) return []
  const settled = await Promise.allSettled(MODULES.map((m) => m.fn(kw)))
  const all: GlobalSearchResult[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') all.push(...r.value)
  })
  return all
}
