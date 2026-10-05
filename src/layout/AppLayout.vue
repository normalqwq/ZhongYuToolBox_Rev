<template>
  <div class="layout-root">
    <!-- 背景封面氛围 -->
    <div class="bg-cover" :style="{ backgroundImage: `url(${bgUrl})` }"></div>

    <!-- 移动端顶栏（置顶，二级页面隐藏） -->
    <header v-if="isMobile && !hideHeader" class="mobile-topbar">
      <el-button text :icon="Menu" class="menu-btn" @click="drawer = true" />
      <span class="mb-title">{{ currentTitle }}</span>
      <div class="mb-right">
        <el-button text :icon="Search" @click="openMobileSearch" />
        <el-tag v-if="proxyLocal" type="success" size="small" effect="dark">加速</el-tag>
        <el-button text :icon="User" @click="goLogin" />
        <el-dropdown trigger="click" @command="onMobileCommand">
          <el-button text :icon="More" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :icon="User" command="user">个人中心</el-dropdown-item>
              <el-dropdown-item :icon="SwitchButton" command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <!-- 移动端全屏搜索遮罩 -->
    <transition name="fade">
      <div v-if="mobileSearchOpen" class="mobile-search-overlay" @click.self="closeMobileSearch">
        <div class="mobile-search-bar">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索笔记 / 随身答 / 错题…"
            clearable
            :prefix-icon="Search"
            size="large"
            @input="onSearchInput"
            @clear="searchResults = []"
          />
          <el-button text @click="closeMobileSearch">取消</el-button>
        </div>
        <div class="search-results mobile">
          <div v-if="searching" class="search-empty">搜索中…</div>
          <template v-else-if="searchResults.length">
            <div v-for="(group, gk) in groupedResults" :key="gk" class="search-group">
              <div class="search-group-title">{{ gk }}</div>
              <div
                v-for="(r, i) in group"
                :key="i"
                class="search-item"
                @click="goResult(r)"
              >
                <div class="search-item-title">{{ r.title }}</div>
                <div v-if="r.subtitle" class="search-item-sub">{{ r.subtitle }}</div>
              </div>
            </div>
          </template>
          <div v-else-if="searchKeyword.trim()" class="search-empty">没有找到相关内容</div>
        </div>
      </div>
    </transition>

    <el-container class="main-container" :class="{ 'is-mobile': isMobile }">
      <!-- 侧边栏（桌面端常驻） -->
      <el-aside v-if="!isMobile" :width="collapsed ? '64px' : '220px'" class="aside">
        <div class="brand">
          <img src="/icon.png" class="brand-icon" alt="中育ToolBox" />
        </div>
        <SideMenu :collapse="collapsed" />
      </el-aside>

      <!-- 主区域 -->
      <el-container>
        <!-- 桌面端顶栏（二级页面隐藏） -->
        <el-header v-if="!isMobile && !hideHeader" class="header">
          <el-icon class="collapse-btn" @click="collapsed = !collapsed">
            <Expand v-if="collapsed" />
            <Fold v-else />
          </el-icon>
          <span class="header-title">{{ currentTitle }}</span>
          <div class="header-search" @click.stop>
            <el-input
              v-model="searchKeyword"
              placeholder="搜索笔记 / 随身答 / 错题…"
              clearable
              :prefix-icon="Search"
              @input="onSearchInput"
              @clear="searchResults = []"
            />
            <transition name="fade">
              <div v-if="searchPanelOpen" class="search-dropdown">
                <div v-if="searching" class="search-empty">搜索中…</div>
                <template v-else-if="searchResults.length">
                  <div v-for="(group, gk) in groupedResults" :key="gk" class="search-group">
                    <div class="search-group-title">{{ gk }}</div>
                    <div
                      v-for="(r, i) in group"
                      :key="i"
                      class="search-item"
                      @click="goResult(r)"
                    >
                      <div class="search-item-title">{{ r.title }}</div>
                      <div v-if="r.subtitle" class="search-item-sub">{{ r.subtitle }}</div>
                    </div>
                  </div>
                </template>
                <div v-else-if="searchKeyword.trim()" class="search-empty">没有找到相关内容</div>
              </div>
            </transition>
          </div>
          <div class="header-right">
            <el-tag v-if="proxyLocal" type="success" size="small" effect="dark">本地加速已启用</el-tag>
            <el-button text :icon="User" @click="goLogin">
              {{ auth.isLoggedIn ? auth.userName : '未登录' }}
            </el-button>
          </div>
        </el-header>

        <el-main class="content" :class="{ flush: hideHeader }" ref="mainRef">
          <!-- 访问说明条：委婉提醒本站仅向名单内的同学开放（二级全屏页面不显示） -->
          <div v-if="!hideHeader" class="access-notice">
            <span class="notice-icon">🌱</span>
            <span class="notice-text">
              小提示：本站是和指定同学分享的小工具箱，仅向名单内的同学开放，链接就不要外传啦～
            </span>
          </div>
          <router-view v-slot="{ Component, route }">
            <transition name="fade" mode="out-in">
              <keep-alive v-if="route.meta.keepAlive">
                <component :is="Component" />
              </keep-alive>
              <component :is="Component" v-else />
            </transition>
          </router-view>
        </el-main>
      </el-container>
    </el-container>

    <!-- 移动端侧边抽屉 -->
    <el-drawer
      v-model="drawer"
      title="中育ToolBox"
      direction="ltr"
      size="72%"
      class="mobile-drawer"
    >
      <SideMenu :collapse="false" @select="drawer = false" />
    </el-drawer>

    <!-- 返回顶部 -->
    <transition name="fade">
      <el-button
        v-show="showBackTop && !isMobile"
        class="back-top"
        circle
        :icon="CaretTop"
        @click="scrollToTop"
      />
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Menu,
  Fold,
  Expand,
  CaretTop,
  User,
  More,
  SwitchButton,
  Search
} from '@element-plus/icons-vue'
import SideMenu from './SideMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { useProxyStore } from '@/stores/proxy'
import { startProxyPolling, stopProxyPolling, getProxyBaseUrl } from '@/utils/proxy'
import { useIsMobile } from '@/composables/useIsMobile'
import { globalSearch, type GlobalSearchResult } from '@/composables/useGlobalSearch'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const proxy = useProxyStore()
const { isMobile } = useIsMobile()

const collapsed = ref(false)
const drawer = ref(false)
const bgUrl = ref(`${import.meta.env.BASE_URL}bg3.jpg`)

const currentTitle = computed(() => (route.meta.title as string) || '中育ToolBox')
/** 二级页面（如笔记预览）隐藏布局顶栏，由页面自身的顶栏接管 */
const hideHeader = computed(() => !!route.meta.hideLayoutHeader)
const proxyLocal = computed(() => proxy.localEnabled)

const mainRef = ref()
const showBackTop = ref(false)

/* -------------------- 全局搜索 -------------------- */
const searchKeyword = ref('')
const searchResults = ref<GlobalSearchResult[]>([])
const searching = ref(false)
const searchPanelOpen = ref(false)
const mobileSearchOpen = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** 按模块分组展示 */
const groupedResults = computed(() => {
  const map: Record<string, GlobalSearchResult[]> = {}
  for (const r of searchResults.value) {
    if (!map[r.typeLabel]) map[r.typeLabel] = []
    map[r.typeLabel].push(r)
  }
  return map
})

async function runSearch() {
  const kw = searchKeyword.value.trim()
  if (!kw) {
    searchResults.value = []
    return
  }
  searching.value = true
  try {
    searchResults.value = await globalSearch(kw)
  } finally {
    searching.value = false
  }
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchPanelOpen.value = true
  searchTimer = setTimeout(() => {
    runSearch()
  }, 350)
}

function goResult(r: GlobalSearchResult) {
  router.push({ name: r.route.name, params: r.route.params })
  searchPanelOpen.value = false
  mobileSearchOpen.value = false
}

function openMobileSearch() {
  mobileSearchOpen.value = true
  setTimeout(() => {
    const input = document.querySelector('.mobile-search-bar input') as HTMLInputElement | null
    input?.focus()
  }, 100)
}
function closeMobileSearch() {
  mobileSearchOpen.value = false
}

/** 点击搜索框外部关闭桌面端下拉 */
function onDocClick(e: MouseEvent) {
  const box = document.querySelector('.header-search')
  if (box && !box.contains(e.target as Node)) {
    searchPanelOpen.value = false
  }
}

function onScroll() {
  const el = document.querySelector('.content')
  const top = el ? el.scrollTop : window.scrollY
  showBackTop.value = top > 300
}
function scrollToTop() {
  const el = document.querySelector('.content')
  if (el) el.scrollTo({ top: 0, behavior: 'smooth' })
  else window.scrollTo({ top: 0, behavior: 'smooth' })
}
function goLogin() {
  router.push('/login')
}
function onMobileCommand(cmd: string) {
  if (cmd === 'user') {
    router.push('/login')
  } else if (cmd === 'logout') {
    auth.logout()
    router.push('/login')
  }
}

function onProxyStatusChange(localOk: boolean, isWindows: boolean) {
  proxy.setStatus(localOk, getProxyBaseUrl())
  if (localOk) {
    ElMessage.success('本地加速服务已启用')
  } else if (isWindows) {
    ElMessage.warning('未检测到加速插件，建议下载 tbHelper 以提升加载速度')
  }
}

onMounted(() => {
  startProxyPolling(onProxyStatusChange)
  const content = document.querySelector('.content')
  content?.addEventListener('scroll', onScroll)
  // 让接管顶栏的二级页面（如在线专栏）也能唤起移动端侧栏抽屉
  window.addEventListener('app:open-drawer', onOpenDrawer)
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  stopProxyPolling()
  const content = document.querySelector('.content')
  content?.removeEventListener('scroll', onScroll)
  window.removeEventListener('app:open-drawer', onOpenDrawer)
  document.removeEventListener('click', onDocClick)
  if (searchTimer) clearTimeout(searchTimer)
})

function onOpenDrawer() {
  drawer.value = true
}
</script>

<style scoped>
.layout-root {
  height: 100vh;
  overflow: hidden;
  position: relative;
}
.bg-cover {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: brightness(0.6);
  z-index: 0;
  pointer-events: none;
}
.main-container {
  position: relative;
  z-index: 1;
  height: 100%;
}
.aside {
  background: #1f2937;
  transition: width 0.25s ease;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  position: relative;
  z-index: 2;
  scrollbar-width: none; /* Firefox 隐藏滚动条 */
}
.aside::-webkit-scrollbar {
  display: none; /* Chrome/Safari/Edge 隐藏滚动条 */
}
.aside {
  -ms-overflow-style: none; /* IE/旧 Edge 隐藏滚动条 */
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px 0;
}
.brand-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}
.header {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  border-bottom: 1px solid #ebeef5;
  padding: 0 16px;
}
.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  margin-right: 12px;
  color: #303133;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.header-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.content {
  background: rgba(245, 247, 250, 0.82);
  overflow-y: auto;
  padding: 20px;
  position: relative;
}
/* 二级页面（顶栏接管）去除内容区内边距，让顶栏贴顶贴边 */
.content.flush {
  padding: 0;
}
/* ===== 访问说明条（暖色、委婉、不吓人） ===== */
.access-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 9px 14px;
  border-radius: 10px;
  background: linear-gradient(90deg, #fff7ed 0%, #fefce8 100%);
  border: 1px solid #fde68a;
  color: #92400e;
  font-size: 13px;
  line-height: 1.5;
}
.access-notice .notice-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.access-notice .notice-text {
  flex: 1;
}
/* 移动端非二级页面收紧左右内边距，避免列表等页面两侧空隙过大 */
@media (max-width: 767px) {
  .content:not(.flush) {
    padding: 8px;
  }
  .access-notice {
    margin-bottom: 8px;
    padding: 8px 10px;
    font-size: 12px;
  }
}
.back-top {
  position: fixed;
  right: 32px;
  bottom: 32px;
  z-index: 2000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ===== 移动端顶栏（置顶） ===== */
.mobile-topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 50px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid #ebeef5;
}
.mobile-topbar .menu-btn {
  font-size: 20px;
}
.mobile-topbar .mb-title {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 8px;
}
.mobile-topbar .mb-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
/* 移动端主容器占满高度 */
.main-container.is-mobile {
  height: calc(100% - 50px);
}
/* 移动端抽屉宽度：按比例并限制最大宽度，避免在大屏手机上过宽 */
.mobile-drawer.el-drawer {
  max-width: 320px;
}

/* ===== 全局搜索 ===== */
.header-search {
  position: relative;
  margin-left: 20px;
  flex: 1;
  max-width: 420px;
}
.search-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  max-height: 60vh;
  overflow-y: auto;
  z-index: 3000;
  padding: 8px 0;
}
.mobile-search-overlay {
  position: fixed;
  inset: 0;
  background: #f5f7fa;
  z-index: 3000;
  display: flex;
  flex-direction: column;
}
.mobile-search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
.search-results.mobile {
  padding: 12px;
}
.search-group {
  margin-bottom: 8px;
}
.search-group-title {
  font-size: 12px;
  color: #909399;
  padding: 6px 12px 4px;
  font-weight: 600;
}
.search-item {
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}
.search-item:hover {
  background: #f0f4ff;
}
.search-item-title {
  font-size: 14px;
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
  padding: 16px 12px;
  text-align: center;
  color: #c0c4cc;
  font-size: 13px;
}
</style>
