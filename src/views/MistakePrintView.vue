<template>
  <div class="print-page">
    <div class="layout">
      <!-- 左：选择 + 配置 -->
      <aside class="panel">
        <!-- 选错题本 -->
        <div class="section">
          <div class="section-title">1. 选择错题本</div>
          <el-select
            v-model="activeBookId"
            placeholder="请选择"
            style="width: 100%"
            @change="onBookChange"
          >
            <el-option
              v-for="b in books"
              :key="b.id"
              :label="b.topic.content"
              :value="String(b.id)"
            />
          </el-select>
        </div>

        <!-- 选错题 -->
        <div class="section">
          <div class="section-title">
            2. 选择错题
            <span class="hint">已选 {{ selectedIds.length }} / {{ list.length }}</span>
            <el-button text size="small" @click="selectAll" :disabled="!list.length">全选</el-button>
            <el-button text size="small" @click="selectedIds = []" :disabled="!selectedIds.length">清空</el-button>
          </div>
          <div v-loading="loading" class="pick-list">
            <el-empty v-if="!loading && list.length === 0" description="暂无错题" :image-size="60" />
            <label
              v-for="item in list"
              :key="item.id"
              class="pick-item"
              :class="{ active: selectedIds.includes(item.id) }"
            >
              <el-checkbox :model-value="selectedIds.includes(item.id)" @change="toggle(item.id)" />
              <el-image :src="proxyImgSrc(item.stemShoot)" fit="cover" class="pick-thumb">
                <template #error>
                  <div class="thumb-ph"><el-icon><Picture /></el-icon></div>
                </template>
              </el-image>
              <div class="pick-meta">
                <div class="pick-src">{{ item.source || '未命名' }}</div>
                <div class="pick-time">{{ (item.creationTime || '').slice(5, 16).replace('T', ' ') }}</div>
              </div>
            </label>
          </div>
        </div>

        <!-- 个性化配置 -->
        <div class="section">
          <div class="section-title">3. 打印内容</div>
          <div class="opt-grid">
            <el-checkbox v-model="opt.showStem">题目</el-checkbox>
            <el-checkbox v-model="opt.showAnswer">答案</el-checkbox>
            <el-checkbox v-model="opt.showAnalysis">解析</el-checkbox>
            <el-checkbox v-model="opt.showNote">我的笔记</el-checkbox>
          </div>
        </div>

        <div class="section">
          <div class="section-title">4. 布局与信息</div>
          <div class="opt-row">
            <span class="opt-label">列数</span>
            <el-radio-group v-model="opt.columns" size="small">
              <el-radio-button :value="1">单列</el-radio-button>
              <el-radio-button :value="2">双列</el-radio-button>
            </el-radio-group>
          </div>
          <div class="opt-row">
            <span class="opt-label">字号</span>
            <el-slider v-model="opt.fontSize" :min="10" :max="18" :step="1" style="flex:1" />
            <span class="opt-val">{{ opt.fontSize }}px</span>
          </div>
          <div class="opt-row">
            <span class="opt-label">题间距</span>
            <el-slider v-model="opt.gap" :min="6" :max="36" :step="2" style="flex:1" />
            <span class="opt-val">{{ opt.gap }}px</span>
          </div>
          <div class="opt-row" style="flex-wrap:wrap;gap:12px;">
            <el-checkbox v-model="opt.showIndex">序号</el-checkbox>
            <el-checkbox v-model="opt.showSource">来源</el-checkbox>
            <el-checkbox v-model="opt.showTime">时间</el-checkbox>
          </div>
        </div>

        <!-- 操作 -->
        <div class="actions">
          <el-button type="primary" :icon="Download" :loading="exporting" @click="doExport" :disabled="!selectedIds.length">
            导出 PDF ({{ selectedIds.length }}题)
          </el-button>
          <el-button :icon="RefreshRight" @click="preparePrintItems" :disabled="!selectedIds.length">
            刷新预览
          </el-button>
        </div>
        <div v-if="progress > 0 && progress < 100" class="prog">
          <el-progress :percentage="progress" :status="progressLabel" />
          <span class="prog-label">{{ progressLabel }}</span>
        </div>
      </aside>

      <!-- 右：预览 -->
      <main class="preview">
        <div class="preview-toolbar">
          <span class="preview-title">预览</span>
          <span class="preview-hint">{{ selectedIds.length }} 题 · {{ opt.columns === 2 ? '双列' : '单列' }}</span>
        </div>
        <div class="preview-body" v-loading="loadingPreview">
          <el-empty v-if="!previewItems.length" description="选择错题后在此预览打印效果" :image-size="80" />
          <div v-else class="preview-paper" :class="{ 'two-col': opt.columns === 2 }">
            <div
              v-for="(item, i) in previewItems"
              :key="i"
              class="paper-block"
            >
              <div v-if="opt.showIndex || opt.showSource || opt.showTime" class="block-info">
                <span v-if="opt.showIndex" class="info-idx">{{ i + 1 }} / {{ previewItems.length }}</span>
                <span v-if="opt.showSource && item.source" class="info-src">{{ item.source }}</span>
                <span v-if="opt.showTime && item.creationTime" class="info-time">{{ item.creationTime.slice(0, 16).replace('T', ' ') }}</span>
              </div>
              <div v-if="opt.showStem" class="block-sec">
                <div class="block-sec-title">题目</div>
                <div v-if="item.stemHtml" class="block-html" v-html="item.stemHtml"></div>
                <el-image v-else-if="item.stemShoot" :src="proxyImgSrc(item.stemShoot)" fit="contain" class="block-img" />
              </div>
              <div v-if="opt.showAnswer && item.answerHtml" class="block-sec">
                <div class="block-sec-title ans">答案</div>
                <div class="block-html" v-html="item.answerHtml"></div>
              </div>
              <div v-if="opt.showAnalysis && item.analysisHtml" class="block-sec">
                <div class="block-sec-title ana">解析</div>
                <div class="block-html" v-html="item.analysisHtml"></div>
              </div>
              <div v-if="opt.showNote && (item.noteImg || (item.picNotes && item.picNotes.length))" class="block-sec">
                <div class="block-sec-title note">我的笔记</div>
                <el-image v-if="item.noteImg" :src="proxyImgSrc(item.noteImg)" fit="contain" class="block-img" />
                <div v-if="item.picNotes && item.picNotes.length" class="note-grid">
                  <el-image
                    v-for="(u, idx) in item.picNotes"
                    :key="idx"
                    :src="proxyImgSrc(u)"
                    fit="contain"
                    class="note-pic"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Picture, Download, RefreshRight } from '@element-plus/icons-vue'
import { proxyImgSrc } from '@/utils/proxy'
import {
  getMyMistakeBooks,
  searchMistakes,
  getMistakeDetail,
  fetchQstHtml,
  fetchNoteScreenshot,
  type MistakeBook,
  type MistakeItem
} from '@/api/mistake'
import {
  exportMistakesPdf,
  DEFAULT_PRINT_OPTIONS,
  type MistakePrintItem,
  type PrintOptions
} from '@/utils/printMistakes'

const books = ref<MistakeBook[]>([])
const activeBookId = ref('')
const list = ref<MistakeItem[]>([])
const selectedIds = ref<(string | number)[]>([])
const loading = ref(false)
const loadingPreview = ref(false)
const exporting = ref(false)
const progress = ref(0)
const progressLabel = ref('')
const previewItems = ref<MistakePrintItem[]>([])

const opt = reactive<PrintOptions>({ ...DEFAULT_PRINT_OPTIONS })

// 加载错题详情并解析为打印项
function parseQstHtml(html: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const stem = doc.querySelector('.stem')?.innerHTML || ''
  let answer = ''
  const answerEl = doc.querySelector('.answers')
  if (answerEl) {
    answerEl.querySelectorAll('h3').forEach((h) => h.remove())
    answer = answerEl.innerHTML.trim()
  }
  let analysis = ''
  const analysisEls = doc.querySelectorAll('.analysis')
  if (analysisEls.length) {
    const parts: string[] = []
    analysisEls.forEach((el) => {
      const clone = el.cloneNode(true) as HTMLElement
      clone.querySelectorAll('h3').forEach((h) => h.remove())
      const t = clone.innerHTML.trim()
      if (t) parts.push(t)
    })
    analysis = parts.join('<hr>')
  }
  return { stem, answer, analysis }
}

async function initBooks() {
  try {
    books.value = await getMyMistakeBooks()
    if (books.value.length) {
      activeBookId.value = String(books.value[0].id)
      await onBookChange(activeBookId.value)
    }
  } catch (e: any) {
    ElMessage.error('加载错题本失败：' + (e.message || e))
  }
}

async function onBookChange(id: string) {
  selectedIds.value = []
  previewItems.value = []
  loading.value = true
  try {
    const res = await searchMistakes(id)
    list.value = res.items || []
  } catch (e: any) {
    ElMessage.error('加载错题失败：' + (e.message || e))
    list.value = []
  } finally {
    loading.value = false
  }
}

function toggle(id: string | number) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}

function selectAll() {
  selectedIds.value = list.value.map((i) => i.id)
}

// 选中的错题条目
function getSelectedItems(): MistakeItem[] {
  return list.value.filter((i) => selectedIds.value.includes(i.id))
}

// 预加载详情，生成打印项
async function preparePrintItems() {
  const items = getSelectedItems()
  if (!items.length) {
    previewItems.value = []
    return
  }
  loadingPreview.value = true
  try {
    const result: MistakePrintItem[] = []
    for (const item of items) {
      const pi: MistakePrintItem = {
        id: item.id,
        source: item.source,
        creationTime: item.creationTime,
        stemShoot: item.stemShoot
      }
      try {
        const detail = await getMistakeDetail(item.id)
        if (detail?.qstPath) {
          const html = await fetchQstHtml(detail.qstPath)
          const parsed = parseQstHtml(html)
          pi.stemHtml = parsed.stem
          pi.answerHtml = parsed.answer
          pi.analysisHtml = parsed.analysis
        }
        if (detail?.note) {
          const url = await fetchNoteScreenshot(detail.note)
          if (url) pi.noteImg = url
        }
        if (detail?.pictureNote) {
          pi.picNotes = [...detail.pictureNote]
        }
      } catch (e) {
        console.warn('加载错题详情失败', item.id, e)
      }
      result.push(pi)
    }
    previewItems.value = result
  } catch (e: any) {
    ElMessage.error('预览加载失败：' + (e.message || e))
  } finally {
    loadingPreview.value = false
  }
}

// 选中变化时自动预览（防抖）
let previewTimer: ReturnType<typeof setTimeout> | null = null
watch(selectedIds, () => {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(preparePrintItems, 300)
}, { deep: true })

async function doExport() {
  if (!previewItems.value.length) {
    await preparePrintItems()
  }
  if (!previewItems.value.length) {
    ElMessage.warning('请先选择错题')
    return
  }
  exporting.value = true
  progress.value = 1
  progressLabel.value = '准备中…'
  try {
    await exportMistakesPdf(previewItems.value, { ...opt }, (p, label) => {
      progress.value = p
      progressLabel.value = label
    })
    ElMessage.success('PDF 导出成功')
  } catch (e: any) {
    ElMessage.error('导出失败：' + (e.message || e))
  } finally {
    exporting.value = false
    setTimeout(() => {
      progress.value = 0
      progressLabel.value = ''
    }, 1500)
  }
}

onMounted(initBooks)
</script>

<style scoped>
.print-page {
  max-width: 1280px;
  margin: 0 auto;
}
.layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.panel {
  width: 340px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.06);
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
}
.section {
  margin-bottom: 16px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.section-title .hint {
  font-weight: 400;
  font-size: 12px;
  color: #909399;
  margin-left: auto;
}
.pick-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 6px;
  min-height: 80px;
}
.pick-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.pick-item:hover {
  background: #f5f7fa;
}
.pick-item.active {
  background: #ecf5ff;
  outline: 1px solid #c6e2ff;
}
.pick-thumb {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  flex-shrink: 0;
  background: #f5f7fa;
}
.thumb-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
}
.pick-meta {
  min-width: 0;
  flex: 1;
}
.pick-src {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-time {
  font-size: 11px;
  color: #909399;
}
.opt-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.opt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.opt-label {
  font-size: 13px;
  color: #606266;
  width: 42px;
  flex-shrink: 0;
}
.opt-val {
  font-size: 12px;
  color: #909399;
  width: 36px;
  text-align: right;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.prog {
  margin-top: 12px;
}
.prog-label {
  font-size: 12px;
  color: #909399;
  display: block;
  margin-top: 4px;
}

/* 预览 */
.preview {
  flex: 1;
  min-width: 0;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  min-height: 600px;
}
.preview-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-title {
  font-weight: 600;
  color: #303133;
}
.preview-hint {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
}
.preview-body {
  padding: 20px;
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  background: #f0f2f5;
}
.preview-paper {
  background: #fff;
  max-width: 640px;
  margin: 0 auto;
  padding: 24px;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.08);
  border-radius: 4px;
}
.preview-paper.two-col {
  column-count: 2;
  column-gap: 16px;
}
.paper-block {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 18px;
  break-inside: avoid;
  font-size: 14px;
  line-height: 1.6;
  color: #222;
}
.two-col .paper-block {
  margin-bottom: 14px;
}
.block-info {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: #909399;
  border-bottom: 1px dashed #ebeef5;
  padding-bottom: 6px;
  margin-bottom: 8px;
}
.info-idx {
  font-weight: 600;
  color: #606266;
}
.block-sec {
  margin-top: 8px;
}
.block-sec-title {
  font-size: 12px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 4px;
}
.block-sec-title.ans {
  color: #67c23a;
}
.block-sec-title.ana {
  color: #e6a23c;
}
.block-sec-title.note {
  color: #67c23a;
}
.block-html {
  color: #303133;
}
.block-html :deep(img) {
  max-width: 100%;
  height: auto;
}
.block-img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 4px;
}
.note-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 6px;
  margin-top: 6px;
}
.note-pic {
  width: 100%;
  height: 100px;
  border-radius: 4px;
  border: 1px solid #eee;
}

@media (max-width: 900px) {
  .layout {
    flex-direction: column;
  }
  .panel {
    width: 100%;
    position: static;
    max-height: none;
  }
  .preview-body {
    max-height: none;
  }
  .preview-paper.two-col {
    column-count: 1;
  }
}
</style>
