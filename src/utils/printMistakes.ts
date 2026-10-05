/**
 * 错题 PDF 导出工具
 * - 把选中的错题按个性化配置渲染成 PDF
 * - 每道题截图后按 A4 自动分页排版
 */
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { proxyImgSrc, proxyFetchUrl } from '@/utils/proxy'

export interface MistakePrintItem {
  id: string | number
  source: string
  creationTime: string
  stemShoot?: string // 题目截图 URL
  stemHtml?: string // 题目 HTML
  answerHtml?: string // 答案 HTML
  analysisHtml?: string // 解析 HTML
  noteImg?: string // 笔记截图 URL
  picNotes?: string[] // 图片笔记 URL 数组
}

export interface PrintOptions {
  showStem: boolean
  showAnswer: boolean
  showAnalysis: boolean
  showNote: boolean
  showSource: boolean
  showTime: boolean
  showIndex: boolean
  columns: 1 | 2
  fontSize: number // px
  gap: number // 题块间距 px
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  showStem: true,
  showAnswer: true,
  showAnalysis: false,
  showNote: false,
  showSource: true,
  showTime: false,
  showIndex: true,
  columns: 1,
  fontSize: 14,
  gap: 18
}

/** 加载图片为 dataURL（解决跨域） */
function loadImageDataURL(rawUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!rawUrl) return resolve(null)
    const url = proxyFetchUrl(proxyImgSrc(rawUrl))
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.92))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** 把 HTML 片段里所有 img 的 src 替换成 dataURL */
async function inlineHtmlImages(html: string): Promise<string> {
  const container = document.createElement('div')
  container.innerHTML = html
  const imgs = Array.from(container.querySelectorAll('img'))
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || ''
      if (!src) return
      const data = await loadImageDataURL(src)
      if (data) img.setAttribute('src', data)
    })
  )
  return container.innerHTML
}

/** 构建单道题的打印块 DOM */
function buildItemBlock(
  item: MistakePrintItem,
  opt: PrintOptions,
  index: number,
  total: number
): HTMLElement {
  const block = document.createElement('div')
  block.style.cssText = `
    border: 1px solid #d0d0d0;
    border-radius: 6px;
    padding: 12px 14px;
    margin-bottom: ${opt.gap}px;
    background: #fff;
    font-size: ${opt.fontSize}px;
    line-height: 1.6;
    color: #222;
    break-inside: avoid;
  `

  // 信息条
  const showInfo = opt.showIndex || opt.showSource || opt.showTime
  if (showInfo) {
    const info = document.createElement('div')
    info.style.cssText =
      'display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:#888;border-bottom:1px dashed #e0e0e0;padding-bottom:6px;margin-bottom:8px;'
    const parts: string[] = []
    if (opt.showIndex) parts.push(`<span style="font-weight:600;color:#444;">${index + 1} / ${total}</span>`)
    if (opt.showSource && item.source) parts.push(`<span>${item.source}</span>`)
    if (opt.showTime && item.creationTime) parts.push(`<span>${item.creationTime.slice(0, 16).replace('T', ' ')}</span>`)
    info.innerHTML = parts.join('<span style="color:#ddd;">|</span>')
    block.appendChild(info)
  }

  const addSection = (title: string, content: string) => {
    if (!content) return
    const sec = document.createElement('div')
    sec.style.marginTop = '6px'
    const t = document.createElement('div')
    t.style.cssText = 'font-size:12px;font-weight:600;color:#409eff;margin-bottom:4px;'
    t.textContent = title
    sec.appendChild(t)
    const body = document.createElement('div')
    body.innerHTML = content
    // 让图片自适应宽度
    body.querySelectorAll('img').forEach((img) => {
      img.style.maxWidth = '100%'
      img.style.height = 'auto'
    })
    sec.appendChild(body)
    block.appendChild(sec)
  }

  // 题目：优先 HTML，退回截图
  if (opt.showStem) {
    if (item.stemHtml) {
      addSection('题目', item.stemHtml)
    } else if (item.stemShoot) {
      const imgWrap = document.createElement('div')
      imgWrap.style.marginTop = '6px'
      const t = document.createElement('div')
      t.style.cssText = 'font-size:12px;font-weight:600;color:#409eff;margin-bottom:4px;'
      t.textContent = '题目'
      imgWrap.appendChild(t)
      const img = document.createElement('img')
      img.style.cssText = 'max-width:100%;height:auto;border-radius:4px;'
      img.src = item.stemShoot // 已是 dataURL
      imgWrap.appendChild(img)
      block.appendChild(imgWrap)
    }
  }
  if (opt.showAnswer && item.answerHtml) addSection('答案', item.answerHtml)
  if (opt.showAnalysis && item.analysisHtml) addSection('解析', item.analysisHtml)

  // 笔记
  if (opt.showNote) {
    const noteImgs: string[] = []
    if (item.noteImg) noteImgs.push(item.noteImg)
    if (item.picNotes) noteImgs.push(...item.picNotes)
    if (noteImgs.length) {
      const wrap = document.createElement('div')
      wrap.style.marginTop = '6px'
      const t = document.createElement('div')
      t.style.cssText = 'font-size:12px;font-weight:600;color:#67c23a;margin-bottom:4px;'
      t.textContent = '我的笔记'
      wrap.appendChild(t)
      noteImgs.forEach((src) => {
        const img = document.createElement('img')
        img.style.cssText = 'max-width:100%;height:auto;border-radius:4px;margin-bottom:6px;border:1px solid #eee;'
        img.src = src // 已是 dataURL
        wrap.appendChild(img)
      })
      block.appendChild(wrap)
    }
  }

  return block
}

/**
 * 导出错题 PDF
 * @param items 已加载好内容的错题
 * @param opt 个性化配置
 * @param onProgress 进度回调 0-100
 */
export async function exportMistakesPdf(
  items: MistakePrintItem[],
  opt: PrintOptions,
  onProgress?: (p: number, label: string) => void
): Promise<void> {
  if (items.length === 0) throw new Error('没有选中的错题')

  const doc = new jsPDF('portrait', 'pt', 'a4')
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 24
  const colGap = 16
  const contentW = pageW - margin * 2
  const colW = opt.columns === 2 ? (contentW - colGap) / 2 : contentW

  // 离屏渲染舞台
  const stage = document.createElement('div')
  stage.style.cssText = `position:fixed;left:-99999px;top:0;width:${colW}px;background:#fff;padding:0;font-family:-apple-system,system-ui,'PingFang SC','Microsoft YaHei',sans-serif;`
  document.body.appendChild(stage)

  // 收集每道题的截图 canvas
  const canvases: { canvas: HTMLCanvasElement; w: number; h: number }[] = []

  for (let i = 0; i < items.length; i++) {
    onProgress?.(Math.round((i / items.length) * 60), `渲染第 ${i + 1}/${items.length} 题`)
    const item = items[i]
    // 预加载图片为 dataURL
    const prepared: MistakePrintItem = { ...item }
    if (prepared.stemShoot) prepared.stemShoot = (await loadImageDataURL(prepared.stemShoot)) || ''
    if (prepared.noteImg) prepared.noteImg = (await loadImageDataURL(prepared.noteImg)) || ''
    if (prepared.picNotes) {
      prepared.picNotes = (
        await Promise.all(prepared.picNotes.map((u) => loadImageDataURL(u)))
      ).filter(Boolean) as string[]
    }
    if (prepared.stemHtml) prepared.stemHtml = await inlineHtmlImages(prepared.stemHtml)
    if (prepared.answerHtml) prepared.answerHtml = await inlineHtmlImages(prepared.answerHtml)
    if (prepared.analysisHtml) prepared.analysisHtml = await inlineHtmlImages(prepared.analysisHtml)

    const block = buildItemBlock(prepared, opt, i, items.length)
    stage.appendChild(block)
    // 等图片解码
    await Promise.all(
      Array.from(block.querySelectorAll('img')).map(
        (img) => (img as HTMLImageElement).complete ? Promise.resolve() : new Promise((r) => {
          img.onload = img.onerror = () => r(null)
        })
      )
    )
    const canvas = await html2canvas(block, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    })
    canvases.push({ canvas, w: colW, h: (canvas.height * colW) / canvas.width })
    stage.removeChild(block)
  }
  document.body.removeChild(stage)
  onProgress?.(65, '正在排版 PDF…')

  // 排版进 PDF
  const colHeights = new Array(opt.columns).fill(margin)
  const maxH = pageH - margin

  for (let i = 0; i < canvases.length; i++) {
    onProgress?.(65 + Math.round((i / canvases.length) * 30), `排版第 ${i + 1}/${canvases.length} 题`)
    const { canvas, w, h } = canvases[i]
    // 选最短列
    let col = 0
    for (let c = 1; c < opt.columns; c++) {
      if (colHeights[c] < colHeights[col]) col = c
    }
    // 该列放不下 → 换页
    if (colHeights[col] - margin + h > maxH) {
      doc.addPage()
      colHeights.fill(margin)
    }
    const x = margin + col * (colW + colGap)
    const y = colHeights[col]

    // 单题超过一页 → 切片
    if (h > maxH) {
      const sliceMaxPx = (maxH * canvas.width) / w
      let sy = 0
      let firstSlice = true
      while (sy < canvas.height) {
        const sliceH = Math.min(sliceMaxPx, canvas.height - sy)
        const slice = document.createElement('canvas')
        slice.width = canvas.width
        slice.height = sliceH
        slice.getContext('2d')!.drawImage(canvas, 0, sy, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
        if (!firstSlice) doc.addPage()
        doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, w, (sliceH * w) / canvas.width)
        firstSlice = false
        sy += sliceH
      }
      colHeights[col] = pageH
    } else {
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, h)
      colHeights[col] += h + opt.gap
    }
  }

  onProgress?.(98, '保存文件…')
  const date = new Date().toISOString().slice(0, 10)
  doc.save(`错题打印_${date}.pdf`)
  onProgress?.(100, '完成')
}
