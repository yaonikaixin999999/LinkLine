<template>
  <div class="ui-shell">
    <aside class="ui-sidebar">
      <router-link class="ui-brand" to="/discover" aria-label="LinkLine 首页"><span class="ui-brand-mark"><img :src="linklineLogo" alt=""></span><span class="ui-brand-wordmark"><BrandWordmark /></span></router-link>
      <div class="ui-sidebar-body scroll">
        <nav aria-label="主导航"><router-link v-for="item in navigation" :key="item.path" :to="item.path" :aria-label="item.label" :title="item.label" :class="{ 'ui-nav-active': route.path.startsWith(item.path) }"><UiIcon :name="item.icon" /><span>{{ item.label }}</span></router-link></nav>
        <div class="ui-personal-section">
          <div class="ui-nav-label">我的音乐</div>
          <div class="ui-personal-links">
            <div class="ui-favorites-entry" :class="{ 'ui-nav-active': route.path === '/list' && route.query.id === 'love' && route.query.view !== 'recent' }"><router-link to="/list?id=love" :aria-label="`喜欢·${favoriteTracks.length}`" :title="`喜欢 · ${favoriteTracks.length} 首`"><UiIcon name="heart" /><span>喜欢<span class="ui-recent-count">·{{ favoriteTracks.length }}</span></span></router-link><HeartbeatButton /></div>
            <router-link :to="{ path: '/list', query: { view: 'recent' } }" :aria-label="`最近播放·${recentTracks.length}`" title="最近播放" :class="{ 'ui-nav-active': recentVisible }"><UiIcon name="clock" /><span>最近播放<span class="ui-recent-count">·{{ recentTracks.length }}</span></span></router-link>
            <router-link to="/local" :aria-label="`本地下载·${deviceMusicCount}`" :title="`本地下载 · ${deviceMusicCount} 首`" :class="{ 'ui-nav-active': route.path === '/local' || route.path === '/download' }"><UiIcon name="download" /><span>本地下载<span class="ui-recent-count">·{{ deviceMusicCount }}</span></span></router-link>
          </div>
        </div>
        <section class="ui-playlist-section" aria-label="我的歌单">
          <button ref="playlistGroupTrigger" type="button" class="ui-playlist-compact-entry" aria-label="歌单分组与创建" title="我的歌单" aria-haspopup="menu" :aria-expanded="playlistGroupOpen" popovertarget="sidebar-playlist-group-menu" @click="positionPlaylistGroup"><UiIcon :name="playlistTab === 'created' ? 'list' : 'heart'" /></button>
          <div class="ui-playlist-tabs"><div role="tablist" aria-label="歌单分组"><button id="sidebar-created-tab" type="button" role="tab" aria-controls="sidebar-playlists" :aria-selected="playlistTab === 'created'" aria-label="自建歌单" @click="playlistTab = 'created'"><UiIcon name="list" /><span>自建歌单</span></button><span aria-hidden="true">|</span><button id="sidebar-collected-tab" type="button" role="tab" aria-controls="sidebar-playlists" :aria-selected="playlistTab === 'collected'" aria-label="收藏歌单" @click="playlistTab = 'collected'"><UiIcon name="heart" /><span>收藏歌单</span></button></div><button type="button" class="ui-create-playlist" aria-label="创建歌单" title="创建歌单" @click="playlistOpen = true"><UiIcon name="plus" /></button></div>
          <div id="sidebar-playlists" class="ui-sidebar-lists scroll" role="tabpanel" :aria-labelledby="playlistTab === 'created' ? 'sidebar-created-tab' : 'sidebar-collected-tab'">
            <router-link v-for="list in sidebarLists" :key="list.id" :aria-label="list.name" :title="list.name" :class="{ 'ui-nav-active': route.path === '/list' && route.query.id === list.id }" :to="{ path: '/list', query: { id: list.id } }" @contextmenu.prevent="openPlaylistMenu($event, list)" @keydown="playlistKey($event, list)"><SidebarPlaylistCover :list="list" :native="!list.platform" /><span>{{ list.name }}</span></router-link>
            <p v-if="playlistTab === 'collected' && !sidebarLists.length" class="ui-playlist-empty">还没有收藏的歌单</p>
          </div>
        </section>
      </div>
    </aside>
    <div class="ui-workspace">
      <header class="ui-topbar"><div class="ui-breadcrumb"><button type="button" class="ui-icon-button" aria-label="返回上一页" @click="router.back()"><UiIcon name="back" /></button></div><SearchBox v-model="query" @submit="search" /><router-link to="/setting" class="ui-icon-button ui-settings-entry" aria-label="设置与偏好" title="设置与偏好" :class="{ 'ui-active': route.path === '/setting' }"><UiIcon name="gear" /></router-link><button type="button" class="ui-icon-button" aria-label="外观定制" title="外观定制" @click="appearancePanelOpen = true"><UiIcon name="palette" /></button><button type="button" class="ui-icon-button" :aria-label="resolvedAppearanceMode === 'light' ? '切换深色' : '切换浅色'" :title="resolvedAppearanceMode === 'light' ? '切换深色' : '切换浅色'" @click="toggleAppearanceMode"><UiIcon :name="resolvedAppearanceMode === 'light' ? 'moon' : 'sun'" /></button><button type="button" class="ui-icon-button linkline-update-topbar" :class="{ 'ui-active': updateAvailable, spinning: updateChecking }" :title="updateButtonLabel" :aria-label="updateButtonLabel" :aria-busy="updateChecking" @click="openUpdateCenter"><UiIcon :name="updateChecking ? 'refresh' : 'cloudDownload'" /><span v-if="updateAvailable" class="linkline-update-dot" aria-hidden="true" /></button><WindowControls /></header>
      <main id="view" class="ui-main-panel">
        <router-view v-slot="{ Component }">
          <Transition name="ll-module-fade" :mode="isShowAnimation ? 'out-in' : undefined" :css="isShowAnimation">
            <RecentPlayback v-if="recentVisible" key="RecentPlayback" :tracks="recentTracks" :persistence-error="musicLinksError" />
            <component :is="Component" v-else :key="route.name || route.path" />
          </Transition>
        </router-view>
      </main>
      <UpdateCenter />
    </div>
    <PlayerBar />
    <Teleport to="body"><p v-if="playerNotice" class="ui-player-notice" role="status" aria-live="polite">{{ playerNotice }}</p></Teleport>
    <Teleport to="body"><div id="sidebar-playlist-group-menu" ref="playlistGroupMenu" popover="auto" class="ui-playlist-context-menu ui-playlist-group-menu" :style="playlistGroupPosition" role="menu" aria-label="我的歌单" @toggle="playlistGroupOpen = $event.newState === 'open'" @keydown="playlistGroupKey">
      <button type="button" role="menuitemradio" :aria-checked="playlistTab === 'created'" autofocus @click="selectPlaylistGroup('created')"><UiIcon name="list" /><span>自建歌单</span><UiIcon v-if="playlistTab === 'created'" name="check" /></button>
      <button type="button" role="menuitemradio" :aria-checked="playlistTab === 'collected'" @click="selectPlaylistGroup('collected')"><UiIcon name="heart" /><span>收藏歌单</span><UiIcon v-if="playlistTab === 'collected'" name="check" /></button>
      <button type="button" role="menuitem" class="ui-playlist-group-create" @click="selectPlaylistGroup('create')"><UiIcon name="plus" /><span>新建歌单</span></button>
    </div></Teleport>
    <PlaylistContextMenu :show="Boolean(menuTarget)" :x="menuPoint.x" :y="menuPoint.y" :editable="menuEditable" :removable="menuTarget?.platform === 'bilibili'" :can-play="menuCanPlay" :trigger="menuTrigger" @close="closePlaylistMenu" @select="playlistMenuAction" />
    <BilibiliPlaylistRemoveDialog :playlist="bilibiliRemoveTarget" @close="bilibiliRemoveTarget = null" @removed="bilibiliRemoved" />
    <PlaylistDialog v-if="contextDialogOpen" :show="contextDialogOpen" :action="contextAction" :list-info="contextList" @close="contextDialogOpen = false" @saved="contextSaved" />
    <UiModal :show="Boolean(menuError)" title="歌单操作未完成" @close="menuError = ''"><p>{{ menuError }}</p></UiModal>
    <PlaylistDialog v-if="playlistOpen" :show="playlistOpen" action="create" :list-info="null" @close="playlistOpen = false" @saved="openCreatedPlaylist" />
  </div>
</template>
<script setup>
import BilibiliPlaylistRemoveDialog from './components/BilibiliPlaylistRemoveDialog.vue'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isShowAnimation } from '@renderer/store/setting'
import { userLists } from '@renderer/store/list/state'
import { LOCAL_LIBRARY_ID } from '@common/localMusic'
import { platformPlaylists, favoriteTracks, loadPlatformPlaylist } from './services/platformAccounts'
import { useDeviceMusicCount } from './useDeviceMusicCount'
import { useRecentPlayback } from './useRecentPlayback'
import { useFavoriteLinks, musicLinksError } from './useMusicLinks'
import { getListMusics, setTempList } from '@renderer/store/list/action'
import { LIST_IDS } from '@common/constants'
import { playList } from '@renderer/core/player'
import { usePlaylistCoverTracking } from './usePlaylistCover'
import PlaylistContextMenu from './components/PlaylistContextMenu.vue'
import SidebarPlaylistCover from './components/SidebarPlaylistCover.vue'
import UiModal from './components/UiModal.vue'
import PlaylistDialog from './components/PlaylistDialog.vue'
import RecentPlayback from './components/RecentPlayback.vue'
import { appearancePanelOpen, resolvedAppearanceMode, toggleAppearanceMode } from '@renderer/composables/useAppearance'
import UiIcon from './components/UiIcon.vue'
import SearchBox from './components/SearchBox.vue'
import PlayerBar from './PlayerBar.vue'
import HeartbeatButton from './components/HeartbeatButton.vue'
import WindowControls from './components/WindowControls.vue'
import UpdateCenter from './components/UpdateCenter.vue'
import { checkUpdateOnStartup, openUpdateCenter, updateAvailable, updateChecking, updateResult } from './services/appUpdate'
import { migratePlayerProgressStyle } from './services/preferences'
import { initializePlayerSessionTools } from './services/playerSessionTools'
import { playerNotice } from './services/playerNotice'
import linklineLogo from '@renderer/assets/images/linkline-logo.svg'
import BrandWordmark from './components/BrandWordmark.vue'
void migratePlayerProgressStyle()
const disposeSessionTools = initializePlayerSessionTools()
onBeforeUnmount(disposeSessionTools)
const route = useRoute()
const router = useRouter()
const query = ref('')
watch(() => route.fullPath, () => {
  query.value = route.path === '/search' && typeof route.query.text === 'string' ? route.query.text : ''
}, { immediate: true })
const playlistTab = ref('created')
const playlistOpen = ref(false)
const playlistGroupTrigger = ref(null)
const playlistGroupMenu = ref(null)
const playlistGroupOpen = ref(false)
const playlistGroupPosition = ref({})
function closePlaylistGroup() { playlistGroupMenu.value?.hidePopover() }
function positionPlaylistGroup() {
  closePlaylistMenu()
  const bounds = playlistGroupTrigger.value.getBoundingClientRect()
  playlistGroupPosition.value = { left: `${Math.min(bounds.right + 8, innerWidth - 184)}px`, top: `${Math.max(8, Math.min(bounds.top, innerHeight - 146))}px` }
}
function selectPlaylistGroup(value) {
  closePlaylistGroup()
  if (value === 'create') playlistOpen.value = true
  else playlistTab.value = value
  playlistGroupTrigger.value?.focus({ preventScroll: true })
}
function playlistGroupKey(event) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = [...playlistGroupMenu.value.querySelectorAll('button')]
  const index = buttons.indexOf(document.activeElement)
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
}
watch(() => route.fullPath, closePlaylistGroup)
const recentVisible = computed(() => route.path === '/list' && route.query.view === 'recent')
const recentTracks = useRecentPlayback()
const deviceMusicCount = useDeviceMusicCount()
useFavoriteLinks()
usePlaylistCoverTracking()
const sidebarLists = computed(() => {
  const lists = userLists.filter(list => list.id !== LOCAL_LIBRARY_ID && Boolean(list.source && list.sourceListId) === (playlistTab.value === 'collected'))
  return playlistTab.value === 'created' ? [...lists, ...platformPlaylists.value] : lists
})
const menuTarget = shallowRef(null)
const menuTrigger = shallowRef(null)
const menuPoint = ref({ x: 0, y: 0 })
const menuCanPlay = ref(false)
const menuError = ref('')
const contextDialogOpen = ref(false)
const contextAction = ref('rename')
const contextList = shallowRef(null)
const menuEditable = computed(() => Boolean(menuTarget.value && userLists.some(list => list.id === menuTarget.value.id)))
const bilibiliRemoveTarget = shallowRef(null)
function bilibiliRemoved(id) { if (route.path === '/list' && route.query.id === id) void router.replace({ path: '/list', query: { id: 'love' } }) }
let menuVersion = 0
function closePlaylistMenu() { menuVersion++; menuTarget.value = null }
async function playlistTracks(list) {
  return platformPlaylists.value.some(item => item.id === list.id) ? (await loadPlatformPlaylist(list.id)).tracks : await getListMusics(list.id)
}
async function openPlaylistMenu(event, list) {
  const request = ++menuVersion
  menuError.value = ''
  menuTarget.value = list
  menuTrigger.value = event.currentTarget
  const bounds = event.currentTarget.getBoundingClientRect()
  menuPoint.value = event.type === 'keydown' ? { x: bounds.right, y: bounds.top } : { x: event.clientX, y: event.clientY }
  menuCanPlay.value = false
  try { const tracks = await playlistTracks(list); if (request === menuVersion) menuCanPlay.value = Boolean(tracks.length) } catch (error) { if (request === menuVersion && list.platform !== 'bilibili') { closePlaylistMenu(); menuError.value = error instanceof Error ? error.message : '暂时无法读取歌单，请重试。' } }
}
function playlistKey(event, list) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault(); void openPlaylistMenu(event, list)
}
async function playlistMenuAction(action) {
  const list = menuTarget.value
  const editable = menuEditable.value
  closePlaylistMenu()
  if (!list) return
  if (action === 'delete' && list.platform === 'bilibili') { bilibiliRemoveTarget.value = list; return }
  if (action !== 'play') {
    if (!editable) return
    contextAction.value = action; contextList.value = userLists.find(item => item.id === list.id); contextDialogOpen.value = true
    return
  }
  try {
    const tracks = await playlistTracks(list)
    if (!tracks.length) return
    if (platformPlaylists.value.some(item => item.id === list.id)) { await setTempList(`platform_playlist__${list.id}`, tracks); playList(LIST_IDS.TEMP, 0) } else playList(list.id, 0)
  } catch (error) { menuError.value = error instanceof Error ? error.message : '暂时无法播放歌单，请重试。' }
}
function contextSaved() {
  contextDialogOpen.value = false
  if (contextAction.value === 'delete' && route.path === '/list' && route.query.id === contextList.value?.id) void router.replace({ path: '/list', query: { id: 'love' } })
}
watch(() => [route.fullPath, playlistTab.value], closePlaylistMenu)
onBeforeUnmount(() => { menuVersion++; window.removeEventListener('resize', closePlaylistGroup) })
const openCreatedPlaylist = id => { playlistTab.value = 'created'; void router.push({ path: '/list', query: { id } }) }
const updateButtonLabel = computed(() => updateChecking.value ? '正在检查更新，打开更新中心' : updateAvailable.value ? `发现 LinkLine ${updateResult.value.latestRelease?.version ?? ''}，打开更新中心` : '检查更新')
onMounted(() => { window.addEventListener('resize', closePlaylistGroup); checkUpdateOnStartup() })
const navigation = [{ path: '/discover', label: '推荐', icon: 'discover' }, { path: '/songList', label: '精选歌单', icon: 'list' }, { path: '/leaderboard', label: '排行榜', icon: 'chart' }]
const search = () => { if (query.value.trim()) void router.push({ path: '/search', query: { text: query.value.trim() } }) }
</script>

<style lang="less">
.ll-module-fade-enter-active { transition: opacity .15s ease; }
.ll-module-fade-leave-active { transition: opacity .1s ease; pointer-events: none; }
.ll-module-fade-enter-from, .ll-module-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .ll-module-fade-enter-active, .ll-module-fade-leave-active { transition: none; } }
.linkline-update-topbar { position: relative; svg { width: 18px; height: 18px; } }
.linkline-update-dot { position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--modern-accent-ink); box-shadow: 0 0 0 2px var(--modern-bg); }
.ui-topbar .ui-breadcrumb > strong { overflow: hidden; text-overflow: ellipsis; }
.ui-topbar .ui-global-search { flex-shrink: 1; min-width: 110px; input { min-width: 0; } }
@media (max-width: 1000px) { .ui-topbar .ui-breadcrumb > span { display: none; } }
@media (max-width: 650px) { .ui-topbar .ui-breadcrumb { gap: 6px; } .ui-topbar .ui-global-search { min-width: 0; width: 125px; } .ui-topbar .ui-global-search > svg:last-child { display: none; } }
</style>

