<template>
  <section ref="pageContainer" class="ui-library ui-library-single-panel">


    <main class="ui-library-main">
      <PlaylistHeader :title="currentName" :compact="headerCompact">
        <template #cover><TrackArtwork v-if="coverTrack" :track="coverTrack" :list-id="listId" :alt="`${currentName} 封面`" /><img v-else-if="currentPlatformList?.cover" :src="currentPlatformList.cover" :alt="`${currentName} 封面`" referrerpolicy="no-referrer"><UiIcon v-else :name="listId === 'love' ? 'heart' : listId === LOCAL_LIBRARY_ID ? 'folder' : 'music'" /></template>
        <template #details><p>{{ tracks.length }} 首歌曲 · {{ currentPlatformList ? `${platformName(currentPlatformList.platform)} · 平台创建歌单` : `${localCount} 首本地音乐` }}</p></template>
        <template #extra><div v-if="currentUserList" class="ui-library-edit"><button type="button" aria-label="重命名当前歌单" @click="openPlaylist('rename')">编辑</button><button type="button" aria-label="删除当前歌单" @click="openPlaylist('delete')">删除</button></div><div v-else-if="currentPlatformList?.platform === 'bilibili'" class="ui-library-edit"><button type="button" @click="bilibiliRemoveTarget = currentPlatformList">从 LinkLine 移除</button></div></template>
        <template #actions>
          <button type="button" class="ui-playlist-header__primary" :disabled="!tracks.length" @click="playFirst"><UiIcon name="play" filled />播放全部</button>
          <button v-if="currentPlatformList" type="button" :disabled="loading" @click="refreshPlatformPlaylist"><UiIcon name="refresh" />同步歌单</button>
          <button v-else type="button" :disabled="importing" @click="importAudioOpen = true">{{ importing ? '正在导入…' : '导入音乐' }}</button>
          <button type="button" :disabled="importing" @click="importPlaylist">导入歌单</button>
          <button type="button" :disabled="!tracks.length" @click="exportPlaylist">导出歌单</button>
        </template>
        <template #tools>
          <label class="ui-library-search"><UiIcon name="search" /><input v-model="query" placeholder="搜索此歌单" aria-label="搜索此歌单"></label>
          <UiSelect :model-value="sort" :options="sortOptions" aria-label="歌单排序" @change="changeSort" />
        </template>
      </PlaylistHeader>

      <div v-if="importProgress && importing" class="ui-library-import-progress" role="status" aria-live="polite"><div><strong>正在扫描并导入本地音乐</strong><p>发现 {{ importProgress.discovered }} 首 · 已导入 {{ importProgress.imported }} 首 · 跳过 {{ importProgress.skipped }} 项 · 失败 {{ importProgress.failed + importProgress.metadataFailed }} 项</p><small :title="importProgress.directory">{{ importProgress.directory || '正在读取所选文件…' }}</small></div><button type="button" :disabled="importCancelled" @click="importCancelled = true">{{ importCancelled ? '正在停止…' : '停止导入' }}</button></div>
      <div v-if="actionError" class="ui-library-error" role="alert">{{ actionError }}<button type="button" aria-label="关闭错误提示" @click="actionError = ''"><UiIcon name="close" /></button></div>
      <div v-if="selected.size" class="ui-library-selection"><span>已选择 {{ selected.size }} 首</span><button type="button" @click="openTrackAction('add', selectedTracks)">加入歌单</button><button type="button" @click="favoriteMany(selectedTracks)">收藏</button><button type="button" @click="openTrackAction('download', selectedTracks)">下载</button><button v-if="canRemoveTracks" type="button" @click="requestRemove(selectedTracks)">移除</button><button type="button" @click="selected = new Set()">取消选择</button></div>
      <div class="ui-library-results">
        <TrackTable ref="trackTable" virtualized :list="filteredTracks" :list-id="listId" :loading="loading" :error="error" :removable="canRemoveTracks" :selected-ids="selected" :empty-title="query ? '没有找到匹配的歌曲' : currentPlatformList ? '平台歌单暂时没有歌曲' : listId === LOCAL_LIBRARY_ID ? '导入文件或文件夹，开始聆听本地音乐' : '给这个歌单加入第一首音乐'" @play="playTrack" @add="addTrack" @download="downloadTrack" @remove="removeTrack" @retry="loadTracks">
          <template #actions="{ track }: { track: LX.Music.MusicInfo }"><button type="button" class="ui-library-row-btn" :class="{ loved: isFavorite(track) }" :aria-pressed="isFavorite(track)" :aria-label="isFavorite(track) ? '取消收藏' : '收藏歌曲'" :disabled="favoritePending.has(track.id)" @click="toggleFavorite(track)"><UiIcon name="heart" :filled="isFavorite(track)" /></button><button v-if="!currentPlatformList" type="button" class="ui-library-row-btn" aria-label="编辑歌曲信息" @click="editTrack(track)"><UiIcon name="more" /></button></template>
          <template #selection="{ track }: { track: LX.Music.MusicInfo }"><input type="checkbox" :checked="selected.has(track.id)" :aria-label="`选择 ${track.name}`" @change="toggleSelected(track.id)"></template>
        </TrackTable>
      </div>
      <footer v-if="filteredTracks.length && selected.size" class="ui-library-pagination"><label><input type="checkbox" :checked="allSelected" @change="selectAll">选择全部</label><span>{{ filteredTracks.length }} 首{{ query ? '搜索结果' : '歌曲' }}</span><span class="ui-library-scroll-hint">向下滚动，继续浏览</span></footer>
      <PlaylistFloatingButtons :tracks="filteredTracks" @jump-current="trackTable?.scrollToIndex($event)" @scroll-to-top="trackTable?.scrollToTop()" />
    </main>

    <PlaylistDialog :show="playlistOpen" :action="playlistAction" :list-info="currentUserList" @close="playlistOpen = false" @saved="playlistSaved" />
    <BilibiliPlaylistRemoveDialog :playlist="bilibiliRemoveTarget" @close="bilibiliRemoveTarget = null" />
    <TrackMetadataModal :show="metadataOpen" :track="metadataTrack" :list-id="listId" @close="metadataOpen = false" @saved="metadataSaved" />
    <TrackActionModal :show="trackActionOpen" :action="trackAction" :tracks="actionTracks" :from-list-id="listId" @close="trackActionOpen = false" @success="handleSuccess" />
    <UiModal :show="importAudioOpen" title="导入本地音乐" subtitle="添加到「本地音乐」，随时可加入其他歌单" @close="importAudioOpen = false"><div class="ui-local-import-options"><button type="button" @click="importAudio('files')"><UiIcon name="music" /><span><strong>选择音乐文件</strong><small>支持同时选择多个音频文件</small></span><UiIcon name="chevronRight" /></button><button type="button" @click="importAudio('folder')"><UiIcon name="folder" /><span><strong>选择文件夹</strong><small>自动递归扫描子文件夹中的音频</small></span><UiIcon name="chevronRight" /></button></div><p class="ui-dialog-note">导入数量不限。自动跳过已导入文件、非音频文件和符号链接；读取失败不会中断其余音乐。导入保留原文件位置，不会复制或删除文件。</p></UiModal>
    <UiModal :show="removeOpen" title="从歌单移除歌曲" :subtitle="`已选择 ${removeTracks.length} 首歌曲`" @close="removeOpen = false"><p class="ui-dialog-note">{{ removesBilibiliLocally ? '所选 B 站视频仅从 LinkLine 音乐库移除，不会取消 B 站收藏；重新同步也不会自动加入。' : '歌曲将从当前歌单移除，本地文件会继续保留。' }}</p><template #footer><button type="button" class="ui-dialog-button" :disabled="removing" @click="removeOpen = false">取消</button><button type="button" class="ui-dialog-button ui-dialog-button-danger" :disabled="removing" @click="confirmRemove">{{ removing ? '移除中…' : '移除歌曲' }}</button></template></UiModal>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import TrackTable from '../components/TrackTable.vue'
import UiModal from '../components/UiModal.vue'
import UiIcon from '../components/UiIcon.vue'
import TrackArtwork from '../components/TrackArtwork.vue'
import PlaylistHeader from '../components/PlaylistHeader.vue'
import PlaylistFloatingButtons from '../components/PlaylistFloatingButtons.vue'
import { playlistCoverTrack, rememberPlaylistCover } from '../usePlaylistCover'
import UiSelect from '../components/UiSelect.vue'
import TrackActionModal from '../components/TrackActionModal.vue'
import PlaylistDialog from '../components/PlaylistDialog.vue'
import BilibiliPlaylistRemoveDialog from '../components/BilibiliPlaylistRemoveDialog.vue'
import type { PlatformPlaylist } from '@common/platformAccounts'
import TrackMetadataModal from '../components/TrackMetadataModal.vue'
import { usePaginationScroll } from '../usePaginationScroll'
import { useCollapsingPlaylistHeader } from '../useCollapsingPlaylistHeader'
import { loveList, userLists } from '@renderer/store/list/state'
import { getListMusics, getUserLists, addListMusics, createUserList, removeListMusics, updateListMusicsPosition, setTempList } from '@renderer/store/list/action'
import { LIST_IDS } from '@common/constants'
import { LOCAL_AUDIO_EXTENSIONS, LOCAL_LIBRARY_ID } from '@common/localMusic'
import { ensureLocalLibrary, importLocalAudio, type LocalImportProgress } from '../services/localLibrary'
import { playList } from '@renderer/core/player'
import { openSaveDir, showSelectDialog } from '@renderer/utils/ipc'
import { getListPrevSelectId, saveListPrevSelectId } from '@renderer/utils/data'
import { filterMusicList, fixNewMusicInfoQuality, toNewMusicInfo, filterFileName } from '@renderer/utils'
import { favoritePending, isFavorite, refreshFavorites, setFavorite, setFavorites, platformPlaylists, platformSnapshot, loadPlatformPlaylist, platformName, initializePlatformAccounts, removeBilibiliLocal } from '../services/platformAccounts'

const route = useRoute()
const router = useRouter()
const listId = ref(typeof route.query.id === 'string' ? route.query.id : loveList.id)
const tracks = ref<LX.Music.MusicInfo[]>([])
const loading = ref(true)
const initialized = ref(false)
const error = ref('')
const actionError = ref('')
const query = ref('')
const sort = ref('original')
const sortOptions = [{ value: 'original', label: '原始排序' }, { value: 'name', label: '按歌曲名称' }, { value: 'singer', label: '按歌手名称' }]
const originalOrder = ref<string[]>([])
const trackTable = ref<{ scrollToIndex: (index: number) => void, scrollToTop: () => void } | null>(null)
const pageContainer = usePaginationScroll([query, listId], '.track-table__rows')
const headerCompact = useCollapsingPlaylistHeader(pageContainer, [query, listId], '.track-table__rows')
const importing = ref(false)
const importAudioOpen = ref(false)
const importProgress = ref<LocalImportProgress | null>(null)
const importCancelled = ref(false)
const selected = ref(new Set<string>())
const playlistOpen = ref(false)
const playlistAction = ref<'create' | 'rename' | 'delete'>('create')
const metadataOpen = ref(false)
const metadataTrack = ref<LX.Music.MusicInfo | null>(null)
const trackActionOpen = ref(false)
const trackAction = ref<'add' | 'download'>('add')
const actionTracks = ref<LX.Music.MusicInfo[]>([])
const removeOpen = ref(false)
const removeTracks = ref<LX.Music.MusicInfo[]>([])
const removing = ref(false)
const bilibiliRemoveTarget = ref<PlatformPlaylist | null>(null)
const playlists = computed(() => [
  { ...loveList, name: '我的收藏', platform: null, cover: '' },
  ...platformPlaylists.value,
  ...userLists.filter(item => item.id !== LOCAL_LIBRARY_ID).map(item => ({ ...item, platform: null, cover: '' })),
])
const currentPlatformList = computed(() => platformPlaylists.value.find(item => item.id === listId.value) ?? null)
const canRemoveTracks = computed(() => !currentPlatformList.value || currentPlatformList.value.platform === 'bilibili')
const removesBilibiliLocally = computed(() => (currentPlatformList.value?.platform === 'bilibili' || listId.value === loveList.id) && removeTracks.value.some(track => track.source === 'bi'))
const currentName = computed(() => playlists.value.find(item => item.id === listId.value)?.name ?? '我的音乐')
const currentUserList = computed(() => listId.value === LOCAL_LIBRARY_ID ? null : userLists.find(item => item.id === listId.value) ?? null)
const coverTrack = computed(() => playlistCoverTrack(listId.value, tracks.value))
const localCount = computed(() => tracks.value.filter(track => track.source === 'local').length)
const filteredTracks = computed(() => {
  const text = query.value.trim().toLowerCase()
  return text ? tracks.value.filter(track => `${track.name} ${track.singer} ${track.meta.albumName}`.toLowerCase().includes(text)) : tracks.value
})
const selectedTracks = computed(() => tracks.value.filter(track => selected.value.has(track.id)))
const allSelected = computed(() => filteredTracks.value.length > 0 && filteredTracks.value.every(track => selected.value.has(track.id)))
let requestId = 0
let active = true
async function loadTracks(background = false, refresh = false) {
  if (!active) return
  const request = ++requestId
  const id = listId.value
  if (!background) loading.value = true
  error.value = ''
  try {
    const data = currentPlatformList.value ? (await loadPlatformPlaylist(id, refresh)).tracks : await getListMusics(id)
    if (request !== requestId) return
    rememberPlaylistCover(id, data)
    tracks.value = [...data]
    const ids = new Set(data.map(track => track.id))
    selected.value = new Set([...selected.value].filter(key => ids.has(key)))
  } catch (err) { if (request === requestId) error.value = err instanceof Error ? err.message : '无法读取歌单，请重试。' } finally { if (request === requestId) loading.value = false }
}
async function loadFavorites() { await refreshFavorites() }
async function chooseList(id: string) {
  if (!active) return
  if (id === LOCAL_LIBRARY_ID) { await router.push('/local'); return }
  await router.replace({ path: '/list', query: { id } })
  if (active && route.path === '/list' && route.query.id === id && listId.value !== id) listId.value = id
}
onBeforeRouteUpdate(to => to.query.id === LOCAL_LIBRARY_ID ? { path: '/local', replace: true } : undefined)
watch(() => route.query.id, id => {
  if (!active || route.path !== '/list') return
  if (id === LOCAL_LIBRARY_ID) { void router.replace('/local'); return }
  if (typeof id === 'string' && id !== listId.value) listId.value = playlists.value.some(item => item.id === id) ? id : loveList.id
})
watch(listId, () => { query.value = ''; sort.value = 'original'; originalOrder.value = []; selected.value = new Set(); removeOpen.value = false; saveListPrevSelectId(listId.value); void loadTracks() })
watch(() => playlists.value.map(item => item.id), () => {
  if (initialized.value && !playlists.value.some(item => item.id === listId.value)) void chooseList(loveList.id)
})
function handleListUpdate(ids: string[]) {
  if (importing.value && ids.every(id => id === LOCAL_LIBRARY_ID)) return
  if (ids.includes(listId.value)) void loadTracks(true)
  if (ids.includes(loveList.id)) void loadFavorites().catch(() => {})
}
onMounted(async() => {
  window.app_event.on('myListUpdate', handleListUpdate)
  try {
    const [, previousId] = await Promise.all([ensureLocalLibrary(), getListPrevSelectId(), initializePlatformAccounts()])
    if (!active) return
    const requestedId = typeof route.query.id === 'string' ? route.query.id : previousId
    initialized.value = true
    if (requestedId === LOCAL_LIBRARY_ID) { await router.replace('/local'); return }
    const id = playlists.value.some(item => item.id === requestedId) ? requestedId : loveList.id
    if (listId.value !== id) await chooseList(id)
    else await loadTracks()
    if (!active) return
    await loadFavorites()
  } catch (err) { if (active) { loading.value = false; error.value = err instanceof Error ? err.message : '音乐库加载失败。' } }
})
onBeforeUnmount(() => { active = false; requestId++; importCancelled.value = true; window.app_event.off('myListUpdate', handleListUpdate) })
function handleSuccess() { selected.value = new Set() }
async function perform(task: () => Promise<void>) {
  actionError.value = ''
  try { await task() } catch (err) { actionError.value = err instanceof Error ? err.message : '操作未能完成，请重试。' }
}
async function playTrack(track: LX.Music.MusicInfo) {
  const index = tracks.value.findIndex(item => item.id === track.id)
  if (index < 0) return
  if (currentPlatformList.value) {
    await perform(async() => {
      await setTempList(`platform_playlist__${listId.value}`, tracks.value.filter((item): item is LX.Music.MusicInfoOnline => item.source !== 'local'))
      playList(LIST_IDS.TEMP, index)
    })
  } else playList(listId.value, index)
}
function playFirst() { if (tracks.value.length) void playTrack(tracks.value[0]) }
async function refreshPlatformPlaylist() { await loadTracks(false, true) }
function openPlaylist(action: 'create' | 'rename' | 'delete') { playlistAction.value = action; playlistOpen.value = true }
async function playlistSaved(id: string) { await getUserLists(); await chooseList(id) }
function editTrack(track: LX.Music.MusicInfo) { metadataTrack.value = track; metadataOpen.value = true }
async function metadataSaved() { await loadTracks() }
function openTrackAction(action: 'add' | 'download', list: LX.Music.MusicInfo[]) { trackAction.value = action; actionTracks.value = [...list]; trackActionOpen.value = true }
function addTrack(track: LX.Music.MusicInfo) { openTrackAction('add', [track]) }
function downloadTrack(track: LX.Music.MusicInfo) { openTrackAction('download', [track]) }
function toggleSelected(id: string) { const next = new Set(selected.value); if (next.has(id)) next.delete(id); else next.add(id); selected.value = next }
function selectAll() { const next = new Set(selected.value); for (const track of filteredTracks.value) { if (allSelected.value) next.delete(track.id); else next.add(track.id) }; selected.value = next }
async function favoriteMany(list: LX.Music.MusicInfo[]) { await perform(async() => { await setFavorites(list, true); await loadFavorites(); selected.value = new Set() }) }
async function toggleFavorite(track: LX.Music.MusicInfo) {
  await perform(async() => { await setFavorite(track, !isFavorite(track)); await loadFavorites() })
}
function requestRemove(list: LX.Music.MusicInfo[]) { removeTracks.value = [...list]; removeOpen.value = true }
function removeTrack(track: LX.Music.MusicInfo) { requestRemove([track]) }
async function confirmRemove() {
  if (removing.value || !canRemoveTracks.value) return
  const id = listId.value
  const list = [...removeTracks.value]
  const localBilibili = removesBilibiliLocally.value
  const ownerId = currentPlatformList.value?.ownerId ?? platformSnapshot.value.accounts.find(account => account.platform === 'bilibili')?.profile?.id
  removing.value = true
  await perform(async() => {
    const bilibili = localBilibili ? list.filter(track => track.source === 'bi') : []
    if (bilibili.length) {
      if (!ownerId) throw new Error('未找到哔哩哔哩账号记录，请重新打开音乐库')
      await removeBilibiliLocal({ ownerId, trackIds: bilibili.map(track => track.id) })
    }
    if (id === loveList.id) {
      if (bilibili.length) await removeListMusics({ listId: id, ids: bilibili.map(track => track.id) })
      const other = list.filter(track => !bilibili.includes(track))
      if (other.length) await setFavorites(other, false)
    } else if (!localBilibili) await removeListMusics({ listId: id, ids: list.map(track => track.id) })
    if (id === listId.value) { await loadTracks(); removeOpen.value = false; selected.value = new Set() }
  })
  removing.value = false
}
async function changeSort(input: string | number) {
  const value = String(input)
  if (value === sort.value) return
  if (sort.value === 'original' && value !== 'original') originalOrder.value = tracks.value.map(track => track.id)
  await perform(async() => {
    const key = value === 'singer' ? 'singer' : 'name'
    const order = new Map(originalOrder.value.map((id, index) => [id, index]))
    const sorted = [...tracks.value].sort((first, second) => value === 'original' ? (order.get(first.id) ?? order.size) - (order.get(second.id) ?? order.size) : first[key].localeCompare(second[key], 'zh-CN'))
    if (currentPlatformList.value) { tracks.value = sorted; sort.value = value; return }
    await updateListMusicsPosition({ listId: listId.value, ids: sorted.map(track => track.id), position: 0 })
    sort.value = value
    await loadTracks()
  })
}
async function importAudio(mode: 'files' | 'folder') {
  if (importing.value) return
  importAudioOpen.value = false
  importing.value = true
  importCancelled.value = false
  importProgress.value = null
  let imported = false
  await perform(async() => {
    const result = await showSelectDialog(mode === 'folder'
      ? { title: '选择音乐文件夹（包含子文件夹）', properties: ['openDirectory', 'multiSelections'] }
      : { title: '导入本地音乐', properties: ['openFile', 'multiSelections'], filters: [{ name: '音频文件', extensions: [...LOCAL_AUDIO_EXTENSIONS] }] })
    if (result.canceled || !result.filePaths.length) return
    if (!active) return
    const resultInfo = await importLocalAudio(result.filePaths, progress => { importProgress.value = progress }, () => importCancelled.value)
    if (!active) return
    imported = true
    if (resultInfo.errors.length) actionError.value = `未能读取：${resultInfo.errors.join('；')}${resultInfo.failed + resultInfo.metadataFailed > resultInfo.errors.length ? ' 等文件或文件夹' : ''}`
  })
  importing.value = false
  if (imported && active) await router.push('/local')
}
async function exportPlaylist() {
  await perform(async() => {
    const result = await openSaveDir({ title: '导出歌单', defaultPath: `${filterFileName(currentName.value)}.lxmc` })
    if (result.canceled || !result.filePath) return
    const info = currentPlatformList.value ? { id: listId.value, name: currentName.value } : playlists.value.find(item => item.id === listId.value)!
    await window.lx.worker.main.saveLxConfigFile(result.filePath, { type: 'playListPart_v2', data: { ...toRaw(info), list: toRaw(tracks.value) } })
  })
}
async function importPlaylist() {
  if (importing.value) return
  importing.value = true
  await perform(async() => {
    const result = await showSelectDialog({ title: '导入歌单文件', properties: ['openFile'], filters: [{ name: '歌单文件', extensions: ['lxmc', 'json'] }] })
    if (result.canceled || !result.filePaths[0]) return
    const config = await window.lx.worker.main.readLxConfigFile(result.filePaths[0]) as { type: string, data: { name: string, list: LX.Music.MusicInfo[] } }
    if (config.type !== 'playListPart' && config.type !== 'playListPart_v2') throw new Error('请选择单个歌单文件；完整备份请在设置中导入。')
    if (!config.data || !Array.isArray(config.data.list)) throw new Error('歌单文件缺少有效的歌曲列表。')
    const info = config.data
    const list = config.type === 'playListPart' ? filterMusicList(info.list.map(track => toNewMusicInfo(track))) : filterMusicList(info.list).map(track => fixNewMusicInfoQuality(track))
    const id = `userlist_${Date.now()}`
    await createUserList({ id, name: `${info.name || '导入歌单'}${userLists.some(item => item.name === info.name) ? '（导入）' : ''}`, list })
    const local = list.filter((track): track is LX.Music.MusicInfoLocal => track.source === 'local')
    if (local.length) {
      await ensureLocalLibrary()
      for (let offset = 0; offset < local.length; offset += 100) await addListMusics(LOCAL_LIBRARY_ID, local.slice(offset, offset + 100), 'bottom')
    }
    await getUserLists()
    await chooseList(id)
  })
  importing.value = false
}
</script>

<style lang="less">
.ui-library { position: relative; height: 100%; display: flex; min-height: 0; color: var(--modern-text); background: var(--modern-panel); }
.ui-library-rail { width: 184px; flex: none; display: flex; flex-direction: column; border-right: 1px solid var(--modern-border); background: var(--modern-panel); }
.ui-library-rail-heading { padding: 24px 16px 16px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; button { display: grid; place-items: center; padding: 0; width: 25px; height: 25px; border: 0; border-radius: 7px; background: var(--modern-panel); color: var(--modern-muted); cursor: pointer; svg { width: 17px; height: 17px; } } }
.ui-library-playlists { flex: 1; min-height: 0; padding: 0 8px; overflow-y: auto; button { width: 100%; padding: 11px 9px; display: flex; align-items: center; gap: 9px; border: 0; border-radius: var(--modern-radius-small); margin-bottom: 4px; background: transparent; color: var(--modern-muted); font-size: 12px; text-align: left; cursor: pointer; span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } &:hover { background: var(--modern-hover); color: var(--modern-text); } &.active { background: var(--modern-accent-soft); color: var(--modern-accent-ink); font-weight: 600; } } }
.ui-library-list-icon { width: 19px; height: 19px; }
.ui-library-list-cover { width: 25px; height: 25px; border-radius: 6px; flex: none; object-fit: cover; }
.ui-library-list-label { min-width: 0; small { display: block; margin-top: 4px; font-size: 9px; font-weight: 400; opacity: .75; } }
.ui-library-rail-bottom { border-top: 1px solid var(--modern-border); padding: 14px 13px; button { display: flex; align-items: center; gap: 7px; width: 100%; border: 0; padding: 7px 0; background: transparent; color: var(--modern-muted); cursor: pointer; font-size: 11px; text-align: left; svg { width: 15px; height: 15px; } &:hover { color: var(--modern-accent-ink); } &:disabled { opacity: .5; } } }
.ui-library-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; padding: 28px 26px 0; background: var(--modern-panel); }
.ui-library-heading { display: flex; align-items: center; gap: 18px; flex: none; }
.ui-library-cover { width: 74px; height: 74px; flex: none; border-radius: var(--modern-radius-small); overflow: hidden; display: grid; place-items: center; background: var(--modern-accent-soft); color: var(--modern-accent-ink); img { width: 100%; height: 100%; object-fit: cover; } svg { width: 35px; height: 35px; } &.love { background: rgba(183, 117, 127, .12); color: #b17b86; } }
.ui-library-title { min-width: 0; h1 { font-size: 25px; font-weight: 600; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } p { font-size: 11px; color: var(--modern-muted); margin-top: 4px; } }
.ui-library-edit { margin-left: auto; display: flex; gap: 8px; button { background: transparent; border: 0; color: var(--modern-muted); cursor: pointer; padding: 6px; font-size: 11px; &:hover { color: var(--modern-accent-ink); } } }
.ui-library-toolbar { display: flex; gap: 8px; align-items: center; padding: 24px 0 18px; flex: none; > button { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; border: 1px solid var(--modern-border); border-radius: var(--modern-radius-small); padding: 9px 12px; background: var(--modern-panel); color: var(--modern-muted); font-size: 11px; cursor: pointer; svg { width: 14px; height: 14px; } &:hover { color: var(--modern-text); background: var(--modern-hover); } &:disabled { opacity: .4; cursor: default; } } button.ui-library-primary { background: var(--modern-text); border-color: transparent; color: var(--modern-panel); } .ui-select { width: 125px; flex: none; } }
.ui-library-search { margin-left: auto; min-width: 60px; display: flex; align-items: center; gap: 6px; padding: 8px 10px; border: 1px solid var(--modern-border); border-radius: var(--modern-radius-small); color: var(--modern-muted); svg { width: 15px; height: 15px; } input { min-width: 0; width: 115px; border: 0; outline: none; background: transparent; font-size: 11px; color: var(--modern-text); font-family: inherit; } }
.ui-library-results { flex: 1; min-height: 0; overflow: hidden; }
.ui-library-error { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-radius: 9px; font-size: 11px; margin-bottom: 10px; background: var(--modern-accent-soft); color: var(--modern-accent-ink); button { border: 0; color: inherit; background: transparent; cursor: pointer; svg { width: 15px; height: 15px; } } }
.ui-library-error { color: #c66666; background: rgba(197, 78, 78, .08); }
.ui-library-import-progress { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 10px; border-radius: var(--modern-radius-small); background: var(--modern-accent-soft); color: var(--modern-accent-ink); font-size: 11px; > div { flex: 1; min-width: 0; } strong { font-size: 12px; } p { margin-top: 5px; } small { display: block; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--modern-muted); } button { flex: none; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--modern-border); background: var(--modern-panel); color: inherit; font-size: 11px; cursor: pointer; &:disabled { opacity: .5; } } }
.ui-local-import-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; button { display: flex; align-items: center; gap: 13px; padding: 16px; border: 1px solid var(--modern-border); border-radius: var(--modern-radius-small); color: var(--modern-text); background: var(--modern-bg); text-align: left; cursor: pointer; &:hover { background: var(--modern-accent-soft); } > svg:first-child { color: var(--modern-accent-ink); width: 24px; height: 24px; } > svg:last-child { margin-left: auto; width: 17px; height: 17px; color: var(--modern-muted); } strong { display: block; font-size: 13px; font-weight: 600; } small { display: block; margin-top: 4px; font-size: 11px; color: var(--modern-muted); } } }
.ui-library-selection { display: flex; gap: 10px; align-items: center; padding: 9px 12px; margin-bottom: 8px; background: var(--modern-accent-soft); color: var(--modern-accent-ink); border-radius: 10px; font-size: 11px; button { border: 0; color: inherit; background: transparent; font-size: 11px; cursor: pointer; } }
.ui-library-row-btn { border: 0; background: transparent; color: var(--modern-muted); padding: 4px; line-height: 1; cursor: pointer; svg { width: 17px; height: 17px; } &.loved { color: var(--ui-favorite); } }
.ui-library-pagination { display: flex; align-items: center; gap: 12px; padding: 14px 0; color: var(--modern-muted); font-size: 10px; flex: none; label { display: flex; align-items: center; gap: 5px; } label + span { margin-right: auto; } button { border: 1px solid var(--modern-border); border-radius: 7px; background: transparent; color: var(--modern-muted); padding: 5px 8px; font-size: 10px; cursor: pointer; &:disabled { opacity: .3; cursor: default; } } }
@media (max-width: 1050px) { .ui-library-rail { width: 155px; } .ui-library-main { padding: 22px 18px 0; } .ui-library-toolbar { flex-wrap: wrap; } .ui-library-search { flex: 1; input { width: 100%; } } }
@media (max-width: 760px) { .ui-library-rail { width: 128px; } .ui-library-main { padding: 18px 12px 0; } .ui-library-cover { width: 48px; height: 48px; font-size: 25px; } .ui-library-title h1 { font-size: 19px; } .ui-library-eyebrow { display: none; } .ui-library-heading { gap: 10px; } .ui-library-edit { flex-direction: column; gap: 0; } }
</style>
