<template>
  <div class="global-search-page">
    <!-- 搜索框 -->
    <div class="search-header">
      <el-input
        v-model="keyword"
        placeholder="搜索云笔记 / 随身答 / 错题本…"
        clearable
        :prefix-icon="Search"
        size="large"
        @input="onInput"
        @keyup.enter="runSearch"
        @clear="onClear"
      >
        <template #append>
          <el-button :icon="Search" size="large" @click="runSearch" />
        </template>
      </el-input>
    </div>

    <!-- 搜索历史（输入为空时展示） -->
    <div v-if="!keyword.trim() && history.length" class="history-section">
      <div class="section-header">
        <span class="section-title">搜索历史</span>
        <el-button text size="small" @click="clearHistory">清除历史</el-button>
      </div>
      <div class="history-tags">
        <el-tag
          v-for="(h, i) in history"
          :key="i"
          class="history-tag"
          effect="plain"
          @click="useHistory(h)"
        >
          <el-icon class="history-tag-icon"><Clock /></el-icon>
          {{ h }}
        </el-tag>
      </div>
    </div>

    <!-- 搜索中 -->
    <div v-else-if="searching" class="status-block">
      <el-icon class="loading-icon" :size="28"><Loading /></el-icon>
      <p>搜索中…</p>
    </div>

    <!-- 搜索结果 -->
    <template v-else-if="results.length">
      <div class="result-count">共找到 {{ results.length }} 条结果</div>
      <div v-for="(group, gk) in grouped" :key="gk" class="result-group">
        <div class="result-group-title">{{ gk }}</div>
        <el-card
          v-for="(r, i) in group"
          :key="i"
          class="result-card"
          shadow="hover"
          @click="go(r)"
        >
          <div class="result-card-title">{{ r.title }}</div>
          <div v-if="r.subtitle" class="result-card-sub">{{ r.subtitle }}</div>
        </el-card>
      </div>
    </template>

    <!-- 无结果 -->
    <div v-else-if="keyword.trim()" class="status-block">
      <el-icon class="empty-icon" :size="40"><Search /></el-icon>
      <p>没有找到与「{{ keyword }}」相关的内容</p>
    </div>

    <!-- 空状态 -->
    <div v-else class="status-block">
      <el-icon class="empty-icon" :size="48"><Search /></el-icon>
      <p>输入关键词，一键搜索云笔记、随身答和错题本</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Clock, Loading } from '@element-plus/icons-vue'
import { globalSearch, type GlobalSearchResult } from '@/composables/useGlobalSearch'

const router = useRouter()
const keyword = ref('')
const results = ref<GlobalSearchResult[]>([])
const searching = ref(false)
const history = ref<string[]>([])
let timer: ReturnType<typeof setTimeout> | null = null

const HISTORY_KEY = 'search_history'
const HISTORY_MAX = 10

const grouped = computed(() => {
  const map: Record<string, GlobalSearchResult[]> = {}
  for (const r of results.value) {
    ;(map[r.typeLabel] ||= []).push(r)
  }
  return map
})

function loadHistory() {
  try {
    history.value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch {
    history.value = []
  }
}
function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
}
function addHistory(kw: string) {
  const k = kw.trim()
  if (!k) return
  history.value = [k, ...history.value.filter((h) => h !== k)].slice(0, HISTORY_MAX)
  saveHistory()
}
function clearHistory() {
  history.value = []
  saveHistory()
}
function useHistory(h: string) {
  keyword.value = h
  runSearch()
}

async function runSearch() {
  const k = keyword.value.trim()
  if (!k) {
    results.value = []
    return
  }
  searching.value = true
  try {
    results.value = await globalSearch(k)
    addHistory(k)
  } finally {
    searching.value = false
  }
}

function onInput() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(runSearch, 350)
}
function onClear() {
  results.value = []
}
function go(r: GlobalSearchResult) {
  router.push({ name: r.route.name, params: r.route.params })
}

onMounted(loadHistory)
</script>

<style scoped>
.global-search-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}

/* 搜索框 */
.search-header {
  margin-bottom: 24px;
}
.search-header :deep(.el-input__wrapper) {
  border-radius: 10px 0 0 10px;
}
.search-header :deep(.el-input-group__append) {
  border-radius: 0 10px 10px 0;
  padding: 0;
  display: flex;
  align-items: stretch;
}
.search-header :deep(.el-input-group__append .el-button) {
  height: 100%;
  border: none;
  border-radius: 0 10px 10px 0;
  margin: 0;
}

/* 搜索历史 */
.history-section {
  margin-bottom: 24px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.section-title {
  font-size: 14px;
  color: #606266;
  font-weight: 600;
}
.history-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.history-tag {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  transition: all 0.15s;
}
.history-tag:hover {
  background: var(--el-color-primary);
  color: #fff;
  border-color: var(--el-color-primary);
}
.history-tag-icon {
  font-size: 12px;
}

/* 结果统计 */
.result-count {
  font-size: 13px;
  color: #909399;
  margin-bottom: 16px;
}

/* 结果分组 */
.result-group {
  margin-bottom: 20px;
}
.result-group-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
  padding-left: 8px;
  border-left: 3px solid var(--el-color-primary);
}
.result-card {
  margin-bottom: 10px;
  cursor: pointer;
  transition: transform 0.12s;
}
.result-card:hover {
  transform: translateX(4px);
}
.result-card-title {
  font-size: 15px;
  color: #303133;
  font-weight: 500;
  line-height: 1.5;
  word-break: break-all;
}
.result-card-sub {
  font-size: 13px;
  color: #909399;
  margin-top: 6px;
  line-height: 1.5;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 状态块 */
.status-block {
  text-align: center;
  padding: 60px 20px;
  color: #909399;
}
.status-block p {
  margin-top: 12px;
  font-size: 14px;
}
.empty-icon {
  color: #dcdfe6;
}
.loading-icon {
  color: var(--el-color-primary);
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 移动端适配 */
@media (max-width: 600px) {
  .global-search-page {
    padding: 12px;
  }
  .result-card-title {
    font-size: 14px;
  }
}
</style>
