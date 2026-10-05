<template>
  <div class="sidebar-search-wrap" @click.stop>
    <!-- 展开态：完整搜索框 -->
    <div v-if="!collapsed" class="sidebar-search">
      <el-input
        v-model="keyword"
        placeholder="搜索笔记/问答/错题"
        clearable
        :prefix-icon="Search"
        size="small"
        @input="onInput"
        @focus="focused = true"
        @blur="onBlur"
        @clear="onClear"
      />
      <transition name="fade">
        <div v-if="focused" class="search-dropdown">
          <!-- 搜索历史（输入为空时展示） -->
          <div v-if="!keyword.trim() && history.length" class="history-block">
            <div class="history-header">
              <span class="history-title">搜索历史</span>
              <el-button text size="small" class="history-clear" @mousedown.prevent="clearHistory">
                清除
              </el-button>
            </div>
            <div
              v-for="(h, i) in history"
              :key="i"
              class="history-item"
              @mousedown.prevent="useHistory(h)"
            >
              <el-icon class="history-icon"><Clock /></el-icon>
              <span class="history-text">{{ h }}</span>
            </div>
          </div>
          <!-- 搜索结果 -->
          <div v-else-if="searching" class="search-empty">搜索中…</div>
          <template v-else-if="results.length">
            <div v-for="(group, gk) in grouped" :key="gk" class="search-group">
              <div class="search-group-title">{{ gk }}</div>
              <div
                v-for="(r, i) in group"
                :key="i"
                class="search-item"
                @mousedown.prevent="go(r)"
              >
                <div class="search-item-title">{{ r.title }}</div>
                <div v-if="r.subtitle" class="search-item-sub">{{ r.subtitle }}</div>
              </div>
            </div>
          </template>
          <div v-else-if="keyword.trim()" class="search-empty">没有找到相关内容</div>
          <div v-else class="search-empty">输入关键词开始搜索</div>
        </div>
      </transition>
    </div>

    <!-- 折叠态：仅图标，点击展开侧栏 -->
    <el-button v-else class="search-icon-btn" :icon="Search" @click="$emit('expand')" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Search, Clock } from '@element-plus/icons-vue'
import { globalSearch, type GlobalSearchResult } from '@/composables/useGlobalSearch'

defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{
  (e: 'expand'): void
  (e: 'navigate', route: { name: string; params?: Record<string, any> }): void
}>()

const keyword = ref('')
const results = ref<GlobalSearchResult[]>([])
const searching = ref(false)
const focused = ref(false)
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
function onBlur() {
  // 延迟失焦，确保点击下拉项的 click 能先触发
  setTimeout(() => {
    focused.value = false
  }, 150)
}
function onClear() {
  results.value = []
}
function go(r: GlobalSearchResult) {
  emit('navigate', r.route)
  focused.value = false
}

onMounted(loadHistory)
onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<style scoped>
.sidebar-search-wrap {
  padding: 10px 12px;
  position: relative;
}
.sidebar-search {
  position: relative;
}
/* 让 el-input 适配深色侧栏 */
.sidebar-search :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.08);
  box-shadow: none;
  border-radius: 8px;
}
.sidebar-search :deep(.el-input__inner) {
  color: #e2e8f0;
}
.sidebar-search :deep(.el-input__inner::placeholder) {
  color: #94a3b8;
}
.sidebar-search :deep(.el-input__prefix-inner),
.sidebar-search :deep(.el-input__suffix-inner) {
  color: #94a3b8;
}
.search-icon-btn {
  width: 100%;
  color: #cbd5e1;
  background: transparent;
  padding: 8px 0;
}
.search-icon-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

/* 下拉面板 */
.search-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  max-height: 60vh;
  overflow-y: auto;
  z-index: 3000;
  padding: 8px 0;
}

/* 搜索历史 */
.history-block {
  padding: 4px 0;
}
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
}
.history-title {
  font-size: 12px;
  color: #909399;
  font-weight: 600;
}
.history-clear {
  padding: 0;
  font-size: 12px;
  color: #909399;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.12s;
}
.history-item:hover {
  background: #f0f4ff;
}
.history-icon {
  color: #c0c4cc;
  font-size: 14px;
  flex-shrink: 0;
}
.history-text {
  font-size: 13px;
  color: #303133;
  word-break: break-all;
}

/* 搜索结果 */
.search-group {
  margin-bottom: 4px;
}
.search-group-title {
  font-size: 12px;
  color: #909399;
  padding: 6px 14px 4px;
  font-weight: 600;
}
.search-item {
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.12s;
}
.search-item:hover {
  background: #f0f4ff;
}
.search-item-title {
  font-size: 13px;
  color: #303133;
  line-height: 1.4;
  word-break: break-all;
}
.search-item-sub {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
  line-height: 1.4;
  word-break: break-all;
}
.search-empty {
  padding: 16px 14px;
  text-align: center;
  color: #c0c4cc;
  font-size: 13px;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
