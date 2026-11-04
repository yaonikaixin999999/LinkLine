// Offline regression coverage: no Bilibili account, cookie, or upstream request.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')
const vue = require('vue')
const { parse, compileScript, compileTemplate } = require('@vue/compiler-sfc')

const root = path.resolve(__dirname, '..')
const native = (id, require) => require(id)
function load(relative, overrides = native, source) {
  const filename = path.join(root, relative)
  const output = ts.transpileModule(source ?? fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const subject = new Module(filename, module)
  subject.filename = filename
  subject.paths = module.paths
  const require = subject.require.bind(subject)
  subject.require = id => overrides(id, require)
  subject._compile(output, filename)
  return subject.exports
}
function temporary(t) {
  const parent = path.join(root, 'node_modules/.cache')
  fs.mkdirSync(parent, { recursive: true })
  const directory = fs.mkdtempSync(path.join(parent, 'bilibili-local-qa-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(parent))
    assert(path.basename(directory).startsWith('bilibili-local-qa-'))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}
const profile = { id: '100', nickname: '测试用户', avatar: '' }
const track = index => ({ id: `bi_BV1xx411c7m${index}`, name: `视频 ${index}`, singer: `作者 ${index}`, source: 'bi', interval: '03:00', meta: { songId: `BV1xx411c7m${index}`, albumName: '', qualitys: [] } })
const tracks = [track(1), track(2), track(3)]
const folder = (id, ownerId = '100') => ({ id: `bilibili:${id}`, remoteId: String(id), ownerId, platform: 'bilibili', name: `收藏夹 ${id}`, cover: '', count: tracks.length, loaded: true, lastSync: 1 })
const localModule = () => load('src/main/modules/platformAccounts/bilibiliLocalLibrary.ts')

function fixture(directory) {
  const handlers = new Map()
  const calls = []
  let current = profile
  let authenticated = false
  const provider = {
    id: 'bilibili', name: '哔哩哔哩', source: 'bi', domains: ['bilibili.com'], loginUrl: 'https://www.bilibili.com/',
    async profile() { calls.push('profile'); return current },
    async likes() { calls.push('likes'); return tracks },
    async playlists() { calls.push('playlists'); return [folder(900, current.id), folder(901, current.id)] },
    async playlistTracks() { calls.push('playlistTracks'); return tracks },
    async like() { calls.push('REMOTE WRITE'); throw new Error('Remote mutations are forbidden') },
  }
  const subject = load('src/main/modules/platformAccounts/index.ts', (id, require) => {
    if (id === 'electron') return {
      app: { getPath: () => directory, once() {} },
      session: { fromPartition: () => ({
        cookies: { get: async() => authenticated ? [{ name: 'SESSDATA', value: 'offline-fixture' }] : [] },
        setPermissionRequestHandler() {}, clearStorageData: async() => { authenticated = false },
        fetch: async() => { throw new Error('Unexpected network request') },
      }) },
    }
    if (id === '@common/mainIpc') return { mainHandle: (channel, handler) => handlers.set(channel, handler) }
    if (id === '@main/modules/winMain/main') return { sendEvent() {} }
    if (id === './bilibiliLocalLibrary') return localModule()
    // The working tree can have an independent VIP cache change; it is irrelevant here.
    if (id === './vipAudioCache') return { createVipAudioCache: () => ({ close() {} }) }
    if (id === './providers/bilibili') return { bilibiliProvider: provider }
    if (id.startsWith('./providers/')) {
      const name = id.slice('./providers/'.length)
      const other = { id: name, source: name, name, loginUrl: 'https://example.com/', domains: [], webOnly: true }
      return { __esModule: true, default: other, [`${name}Provider`]: other }
    }
    if (id === './matching') return load('src/common/platformMatching.ts')
    if (id === './navigation') return { registerAccountSession() {} }
    if (id === './playback') return { createPlaybackResolver: () => ({}) }
    if (id === '../userApi/playback') return { getImportedPlaybackSources: () => [] }
    if (id === './qishuiLoginDiagnostics') return { createQishuiLoginDiagnosticWriter: () => () => {} }
    if (['./qishuiLogin', './qishuiPassport', './bodianLogin', './nativeLogin'].includes(id)) return {}
    return require(id)
  })
  subject.default()
  return {
    calls, invoke: (channel, params) => handlers.get(channel)({ params }),
    login: ownerId => { current = { ...profile, id: ownerId }; authenticated = true },
  }
}
function seed(directory, ownerId = '100') {
  fs.writeFileSync(path.join(directory, 'platform-favorites.json'), JSON.stringify([{
    platform: 'bilibili', profile: { ...profile, id: ownerId }, tracks,
    playlists: [900, 901].map(id => ({ playlist: folder(id, ownerId), tracks })),
  }]))
}
const snapshot = f => f.invoke('platform_accounts_snapshot')
const remove = (f, params) => f.invoke('platform_bilibili_remove_local', params)
const playlist = (f, id = 'bilibili:901', refresh = false) => f.invoke('platform_accounts_playlist', { id, refresh })

test('offline playlist removal survives restart, resync, and re-login without any remote mutation', async t => {
  const directory = temporary(t)
  seed(directory)
  const f = fixture(directory)
  assert.equal((await snapshot(f)).playlists.length, 2)
  const result = await remove(f, { ownerId: '100', playlistId: 'bilibili:900' })
  assert.deepEqual(result.playlists.map(item => item.id), ['bilibili:901'])
  assert.equal(result.favorites.length, 3, 'removing a folder does not remove unrelated default favorites')
  assert.deepEqual(f.calls, [], 'offline removal performs no profile check or upstream request')
  await assert.rejects(playlist(f, 'bilibili:900'), /已从 LinkLine 移除/)
  assert.deepEqual(f.calls, [])
  const restarted = fixture(directory)
  assert.equal((await snapshot(restarted)).playlists.length, 1)
  restarted.login('100')
  assert.equal((await restarted.invoke('platform_accounts_sync', 'bilibili')).playlists.length, 1)
  await restarted.invoke('platform_accounts_logout', 'bilibili')
  restarted.login('100')
  assert.equal((await restarted.invoke('platform_accounts_sync', 'bilibili')).playlists.length, 1)
  assert(!restarted.calls.includes('REMOTE WRITE'))
})

test('single/bulk video removal filters favorites, playlist details and counts after refresh/restart', async t => {
  const directory = temporary(t)
  seed(directory)
  const f = fixture(directory)
  await remove(f, { ownerId: '100', trackIds: [tracks[0].id, tracks[2].id] })
  assert.deepEqual(f.calls, [])
  const state = await snapshot(f)
  assert.deepEqual(state.favorites.map(item => item.track.id), [tracks[1].id])
  assert.equal(state.accounts.find(item => item.platform === 'bilibili').count, 1)
  assert(state.playlists.every(item => item.count === 1))
  assert.deepEqual((await playlist(f)).tracks.map(item => item.id), [tracks[1].id])
  f.login('100')
  await f.invoke('platform_accounts_sync', 'bilibili')
  assert.equal((await playlist(f, 'bilibili:901', true)).tracks.length, 1)
  assert.equal((await snapshot(f)).playlists.find(item => item.id === 'bilibili:901').count, 1)
  const restarted = fixture(directory)
  assert.equal((await playlist(restarted)).tracks.length, 1)
  assert(!f.calls.includes('REMOTE WRITE'))
  const raw = JSON.parse(fs.readFileSync(path.join(directory, 'platform-favorites.json')))
  assert.equal(raw.find(item => item.platform === 'bilibili').tracks.length, 3, 'original upstream cache stays intact')
})

test('exclusions are isolated by account, reject foreign IDs, and leave other platforms untouched', async t => {
  const directory = temporary(t)
  seed(directory)
  const f = fixture(directory)
  await remove(f, { ownerId: '100', playlistId: 'bilibili:900' })
  await remove(f, { ownerId: '100', trackIds: [tracks[0].id] })
  await assert.rejects(remove(f, { ownerId: '200', playlistId: 'bilibili:901' }), /账号已更改/)
  await assert.rejects(remove(f, { ownerId: '100', playlistId: 'bilibili:999' }), /不属于当前/)
  await assert.rejects(remove(f, { ownerId: '100', trackIds: [track(9).id] }), /不属于当前/)
  f.login('200')
  const next = await f.invoke('platform_accounts_sync', 'bilibili')
  assert.equal(next.playlists.length, 2)
  assert.equal(next.favorites.length, 3)
  f.login('100')
  const restored = await f.invoke('platform_accounts_sync', 'bilibili')
  assert.equal(restored.playlists.length, 1)
  assert.equal(restored.favorites.length, 2)
  const local = localModule().createBilibiliLocalLibrary(() => path.join(directory, 'bilibili-local-library.json'))
  await local.init()
  assert(local.visible({ ...folder(900), platform: 'netease' }))
  const other = { playlist: { ...folder(900), platform: 'netease' }, tracks, cached: true }
  assert.equal(local.detail(other), other)
})

test('serialized concurrent removals persist every exclusion, including repeated clicks', async t => {
  const directory = temporary(t)
  const file = path.join(directory, 'exclusions.json')
  const local = localModule().createBilibiliLocalLibrary(() => file)
  await Promise.all([
    ...tracks.map(item => local.remove({ ownerId: '100', trackIds: [item.id] })),
    local.remove({ ownerId: '100', playlistId: 'bilibili:900' }),
    local.remove({ ownerId: '100', trackIds: [tracks[0].id] }),
  ])
  const persisted = JSON.parse(fs.readFileSync(file)).owners[0]
  assert.deepEqual(persisted.tracks.sort(), tracks.map(item => item.id).sort())
  assert.deepEqual(persisted.playlists, ['bilibili:900'])
  assert(!fs.existsSync(`${file}.tmp`))
})

test('invalid requests and failed disk writes never hide items or corrupt existing exclusions', async t => {
  const directory = temporary(t)
  let file = path.join(directory, 'exclusions.json')
  const local = localModule().createBilibiliLocalLibrary(() => file)
  await local.remove({ ownerId: '100', trackIds: [tracks[0].id] })
  for (const params of [null, {}, { ownerId: '../100', trackIds: [] }, { ownerId: '100', trackIds: [] }, { ownerId: '100', trackIds: ['wy_1'] }, { ownerId: '100', playlistId: '../../file' }, { ownerId: '100', playlistId: 'bilibili:900', trackIds: [tracks[0].id] }]) {
    await assert.rejects(local.remove(params), /无效/)
  }
  const previous = fs.readFileSync(file, 'utf8')
  file = path.join(directory, 'missing/exclusions.json')
  await assert.rejects(local.remove({ ownerId: '100', playlistId: 'bilibili:900' }), /ENOENT/)
  assert(local.visible(folder(900)))
  file = path.join(directory, 'exclusions.json')
  assert.equal(fs.readFileSync(file, 'utf8'), previous)
  await local.remove({ ownerId: '100', playlistId: 'bilibili:901' })
  assert(!local.visible(folder(901)), 'a failed write does not poison subsequent operations')
})

test('transient Windows destination locks are retried without deleting the original file', async t => {
  const directory = temporary(t)
  const file = path.join(directory, 'exclusions.json')
  let attempts = 0
  const realFs = require('node:fs/promises')
  const { createBilibiliLocalLibrary } = load('src/main/modules/platformAccounts/bilibiliLocalLibrary.ts', (id, require) => {
    if (id === 'node:fs/promises') return { ...realFs, rename: async(...args) => {
      attempts++
      if (attempts <= 2) throw Object.assign(new Error('File is locked'), { code: 'EPERM' })
      return realFs.rename(...args)
    } }
    return require(id)
  })
  const local = createBilibiliLocalLibrary(() => file)
  await local.remove({ ownerId: '100', playlistId: 'bilibili:900' })
  assert.equal(attempts, 3)
  assert(!local.visible(folder(900)))
  assert.equal(JSON.parse(fs.readFileSync(file)).owners[0].playlists[0], 'bilibili:900')
})

test('renderer reconciles removed synced favorites locally, preserving manually added/other favorites', async() => {
  const values = new Map([['linkline.platform-favorites.imported.v1', JSON.stringify(tracks.map(item => `bi:${item.id}`))]])
  const other = { ...tracks[1], id: 'wy_500', source: 'wy', name: '其他平台', singer: '其他歌手' }
  const manual = { ...track(9), name: '手动收藏' }
  let saved = [...tracks, other, manual]
  const requests = []
  const previous = { localStorage: global.localStorage, window: global.window }
  global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  global.window = { app_event: { on() {}, off() {} } }
  try {
    let state = { accounts: [], favorites: tracks.map(item => ({ track: item })) }
    const service = load('src/renderer/ui/services/platformAccounts.ts', (id, require) => {
      if (id === 'electron') return { ipcRenderer: { on() {}, invoke: async(channel, params) => { requests.push({ channel, params }); return state } } }
      if (id === '@common/platformAccounts') return load('src/common/platformAccounts.ts')
      if (id === '@common/platformMatching') return load('src/common/platformMatching.ts')
      if (id === '@renderer/store/list/state') return { loveList: { id: 'love' } }
      if (id === '@renderer/store/list/action') return {
        getListMusics: async() => saved,
        removeListMusics: async({ ids }) => { saved = saved.filter(item => !ids.includes(item.id)) },
        addListMusics: async(_id, list) => { saved.push(...list) }, updateListMusics: async() => {},
      }
      if (['./qishuiLogin', './bodianLogin', './nativeQrLogin'].includes(id)) return {}
      return require(id)
    })
    await service.initializePlatformAccounts()
    state = { accounts: [], favorites: [{ track: tracks[1] }], playlists: [] }
    await service.removeBilibiliLocal({ ownerId: '100', trackIds: [tracks[0].id, tracks[2].id] })
    assert.deepEqual(saved.map(item => item.id), [tracks[1].id, other.id, manual.id])
    assert.deepEqual(requests.map(item => item.channel), ['platform_accounts_snapshot', 'platform_bilibili_remove_local'])
    assert.equal(service.platformPlaylists.value.length, 0)
  } finally {
    global.localStorage = previous.localStorage
    global.window = previous.window
  }
})

function libraryFixture(id, options = {}) {
  const filename = 'src/renderer/ui/views/Library.vue'
  const { descriptor } = parse(fs.readFileSync(path.join(root, filename), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'bilibili-library-qa' })
  const calls = []
  const route = vue.reactive({ path: '/list', query: { id } })
  const other = { ...track(4), source: 'wy', id: 'wy_400' }
  let remaining = [...tracks, other, ...(options.extraTracks ?? [])]
  const component = load(filename, (id, require) => {
    if (id === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount() {} }
    if (id === 'vue-router') return { useRoute: () => route, useRouter: () => ({ replace: async() => {} }), onBeforeRouteUpdate() {} }
    if (id.endsWith('.vue')) return { __esModule: true, default: {} }
    if (id === '../usePaginationScroll') return { usePaginationScroll: () => vue.ref(null) }
    if (id === '../useCollapsingPlaylistHeader') return { useCollapsingPlaylistHeader: () => vue.ref(false) }
    if (id === '../usePlaylistCover') return { playlistCoverTrack: () => null, rememberPlaylistCover() {} }
    if (id === '@renderer/store/list/state') return { loveList: { id: 'love' }, userLists: [{ id: 'local-list' }] }
    if (id === '@renderer/store/list/action') return {
      getListMusics: async() => remaining,
      removeListMusics: async(params) => { calls.push(['local-list', params]); remaining = remaining.filter(item => !params.ids.includes(item.id)) },
    }
    if (id === '@renderer/utils/data') return { saveListPrevSelectId() {} }
    if (id === '@common/constants') return { LIST_IDS: { TEMP: 'temp' } }
    if (id === '@common/localMusic') return { LOCAL_LIBRARY_ID: 'local-library' }
    if (id === '../services/platformAccounts') return {
      platformPlaylists: vue.ref([folder(900), { ...folder(901), id: 'qq:901', platform: 'qq' }]),
      platformSnapshot: vue.ref({
        accounts: options.noAccount ? [] : [{ platform: 'bilibili', profile }],
        favorites: options.favorites ?? (options.syncedTracks ?? tracks).map(item => ({ track: item, platforms: [{ platform: 'bilibili', track: item }] })),
      }),
      loadPlatformPlaylist: async() => ({ tracks: remaining }),
      removeBilibiliLocal: async(params) => { calls.push(['local-bilibili', params]); remaining = remaining.filter(item => !params.trackIds.includes(item.id)) },
      setFavorites: async(list, value) => { calls.push(['favorites', list.map(item => item.id), value]) },
    }
    if (['../services/localLibrary', '@renderer/core/player', '@renderer/utils/ipc', '@renderer/utils'].includes(id)) return {}
    return require(id)
  }, compiled.content).default
  const scope = vue.effectScope()
  const state = scope.run(() => component.setup({}, { expose() {} }))
  return { state, calls, other, stop: () => scope.stop() }
}

test('real Library single/bulk Bilibili video actions never call remote favorite mutation', async() => {
  const f = libraryFixture('bilibili:900')
  try {
    assert.equal(f.state.canRemoveTracks.value, true)
    f.state.requestRemove([tracks[0], tracks[2]])
    assert.equal(f.state.removesBilibiliLocally.value, true)
    await f.state.confirmRemove()
    assert.deepEqual(f.calls, [['local-bilibili', { ownerId: '100', trackIds: [tracks[0].id, tracks[2].id] }]])
    assert.equal(f.state.removeOpen.value, false)
    assert.equal(f.state.tracks.value.length, 2)
  } finally { f.stop() }
})

test('real Library mixed favorites removal uses local-only Bilibili removal and normal handling for other songs', async() => {
  const f = libraryFixture('love')
  try {
    f.state.requestRemove([tracks[0], f.other])
    await f.state.confirmRemove()
    assert.deepEqual(f.calls, [
      ['local-bilibili', { ownerId: '100', trackIds: [tracks[0].id] }],
      ['local-list', { listId: 'love', ids: [tracks[0].id] }],
      ['favorites', [f.other.id], false],
    ])
  } finally { f.stop() }
})

test('real Library can remove manually saved Bilibili favorites without an account or platform mutation', async() => {
  const manual = track(9)
  const f = libraryFixture('love', { noAccount: true, syncedTracks: [], extraTracks: [manual] })
  try {
    f.state.requestRemove([manual])
    await f.state.confirmRemove()
    assert.equal(f.state.actionError.value, '')
    assert.equal(f.state.removeOpen.value, false)
    assert.deepEqual(f.calls, [['local-list', { listId: 'love', ids: [manual.id] }]])
    assert(!f.state.tracks.value.some(item => item.id === manual.id))
  } finally { f.stop() }
})

test('real Library excludes synced Bilibili favorites while removing unsynced manual videos locally', async() => {
  const manual = track(9)
  const f = libraryFixture('love', { extraTracks: [manual] })
  try {
    f.state.requestRemove([tracks[0], manual])
    await f.state.confirmRemove()
    assert.equal(f.state.actionError.value, '')
    assert.deepEqual(f.calls, [
      ['local-bilibili', { ownerId: '100', trackIds: [tracks[0].id] }],
      ['local-list', { listId: 'love', ids: [tracks[0].id, manual.id] }],
    ])
    assert.equal(f.state.removeOpen.value, false)
  } finally { f.stop() }
})

test('real Library persists Bilibili exclusions when an aggregated favorite uses another platform representative', async() => {
  const representative = { ...tracks[0], id: 'wy_500', source: 'wy' }
  const f = libraryFixture('love', { favorites: [{
    track: representative,
    platforms: [{ platform: 'netease', track: representative }, { platform: 'bilibili', track: tracks[0] }],
  }] })
  try {
    f.state.requestRemove([tracks[0]])
    await f.state.confirmRemove()
    assert.equal(f.state.actionError.value, '')
    assert.deepEqual(f.calls, [
      ['local-bilibili', { ownerId: '100', trackIds: [tracks[0].id] }],
      ['local-list', { listId: 'love', ids: [tracks[0].id] }],
    ])
  } finally { f.stop() }
})

test('real Library retains other-platform read-only rules and ordinary local playlist removal', async() => {
  const remote = libraryFixture('qq:901')
  const local = libraryFixture('local-list')
  try {
    assert.equal(remote.state.canRemoveTracks.value, false)
    remote.state.requestRemove([tracks[0]])
    await remote.state.confirmRemove()
    assert.deepEqual(remote.calls, [])
    local.state.requestRemove([tracks[0]])
    await local.state.confirmRemove()
    assert.deepEqual(local.calls, [['local-list', { listId: 'local-list', ids: [tracks[0].id] }]])
  } finally { remote.stop(); local.stop() }
})

test('all changed Vue templates compile, including sidebar and Bilibili removal entry points', () => {
  for (const filename of ['Shell.vue', 'views/Library.vue', 'components/PlaylistContextMenu.vue', 'components/BilibiliPlaylistRemoveDialog.vue']) {
    const { descriptor, errors } = parse(fs.readFileSync(path.join(root, 'src/renderer/ui', filename), 'utf8'), { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: filename })
    const template = compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings, expressionPlugins: ['typescript'] } })
    assert.deepEqual(template.errors, [], filename)
  }
})

test('real sidebar permits removing an unreadable Bilibili folder and returns to favorites after removal', async() => {
  const filename = 'src/renderer/ui/Shell.vue'
  const { descriptor } = parse(fs.readFileSync(path.join(root, filename), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'bilibili-sidebar-qa' })
  const navigations = []
  const component = load(filename, (id, require) => {
    if (id === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount() {} }
    if (id === 'vue-router') return {
      useRoute: () => ({ path: '/list', fullPath: '/list?id=bilibili:900', query: { id: 'bilibili:900' } }),
      useRouter: () => ({ replace: value => { navigations.push(value); return Promise.resolve() } }),
    }
    if (id.endsWith('.vue') || id.endsWith('.svg')) return { __esModule: true, default: {} }
    if (id === '@renderer/store/list/state') return { userLists: [] }
    if (id === '@common/localMusic') return { LOCAL_LIBRARY_ID: 'local-library' }
    if (id === './services/platformAccounts') return {
      platformPlaylists: vue.ref([folder(900)]), favoriteTracks: vue.ref([]),
      loadPlatformPlaylist: async() => { throw new Error('登录已过期') },
    }
    if (id === './useDeviceMusicCount') return { useDeviceMusicCount: () => vue.ref(0) }
    if (id === './useRecentPlayback') return { useRecentPlayback: () => vue.ref([]) }
    if (id === './useMusicLinks') return { useFavoriteLinks() {} }
    if (id === './usePlaylistCover') return { usePlaylistCoverTracking() {} }
    if (id === './services/preferences') return { migratePlayerProgressStyle: async() => {} }
    if (id === './services/playerSessionTools') return { initializePlayerSessionTools: () => () => {} }
    if (id.startsWith('@renderer/') || id.startsWith('@common/') || id.startsWith('./services/')) return {}
    return require(id)
  }, compiled.content).default
  const scope = vue.effectScope()
  try {
    const state = scope.run(() => component.setup({}, { expose() {} }))
    await state.openPlaylistMenu({ type: 'contextmenu', currentTarget: { getBoundingClientRect: () => ({}) }, clientX: 1, clientY: 1 }, folder(900))
    assert.equal(state.menuTarget.value.id, 'bilibili:900', 'failed loading must leave the removal menu accessible')
    assert.equal(state.menuError.value, '', 'an error dialog must not cover the removal menu')
    await state.playlistMenuAction('delete')
    assert.equal(state.bilibiliRemoveTarget.value.id, 'bilibili:900')
    state.bilibiliRemoved('bilibili:900')
    assert.deepEqual(navigations, [{ path: '/list', query: { id: 'love' } }])
  } finally { scope.stop() }
})

// Mount real compiled Vue components with a tiny in-memory host. UiModal is a
// slot host here; the dialog's own template, events and asynchronous logic run.
function mountDialog(operation) {
  const filename = 'src/renderer/ui/components/BilibiliPlaylistRemoveDialog.vue'
  const { descriptor } = parse(fs.readFileSync(path.join(root, filename), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'bilibili-local-qa', inlineTemplate: true })
  const component = load(filename, (id, require) => {
    if (id === '../services/platformAccounts') return { removeBilibiliLocal: operation }
    if (id === './UiModal.vue') return { __esModule: true, default: { props: ['show', 'title', 'subtitle'], setup: (props, { slots }) => () => props.show ? vue.h('section', [props.title, props.subtitle, slots.default?.(), slots.footer?.()]) : null } }
    return require(id)
  }, compiled.content).default
  const node = type => ({ type, children: [], props: {}, text: '' })
  const renderer = vue.createRenderer({
    createElement: node, createText: text => ({ ...node('#text'), text }), createComment: () => node('#comment'),
    setText: (target, text) => { target.text = text }, setElementText: (target, text) => { target.text = text; target.children = [] },
    patchProp: (target, key, _old, value) => { target.props[key] = value },
    insert: (child, parent, anchor) => { child.parent = parent; const index = parent.children.indexOf(anchor); if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child) },
    remove: target => { if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1) },
    parentNode: target => target.parent, nextSibling: () => null,
  })
  const container = node('root')
  const events = []
  const app = renderer.createApp(component, { playlist: folder(900), onRemoved: id => events.push(['removed', id]), onClose: () => events.push(['close']) })
  app.mount(container)
  const descendants = target => [target, ...target.children.flatMap(descendants)]
  return { app, events, all: () => descendants(container), buttons: () => descendants(container).filter(item => item.type === 'button') }
}

test('real removal dialog confirms local-only behavior, cancels safely and prevents duplicate submissions', async() => {
  const requests = []
  let finish
  const ui = mountDialog(params => { requests.push(params); return new Promise(resolve => { finish = resolve }) })
  try {
    assert(ui.all().some(item => item.text.includes('不会删除 B 站收藏夹')))
    ui.buttons()[0].props.onClick()
    assert.deepEqual(ui.events, [['close']])
    assert.equal(requests.length, 0)
    const first = ui.buttons()[1].props.onClick()
    await ui.buttons()[1].props.onClick()
    await vue.nextTick()
    assert(ui.buttons().every(item => item.props.disabled))
    ui.buttons()[0].props.onClick()
    assert.deepEqual(ui.events, [['close']], 'busy cancellation cannot close a pending mutation')
    finish()
    await first
    assert.deepEqual(requests, [{ ownerId: '100', playlistId: 'bilibili:900' }])
    assert.deepEqual(ui.events, [['close'], ['removed', 'bilibili:900'], ['close']])
  } finally { ui.app.unmount() }
})

test('real removal dialog reports persistence errors and keeps the playlist available for retry', async() => {
  const ui = mountDialog(async() => { throw new Error('磁盘写入失败') })
  try {
    await ui.buttons()[1].props.onClick()
    await vue.nextTick()
    assert(ui.all().some(item => item.props.role === 'alert' && item.text === '磁盘写入失败'))
    assert.deepEqual(ui.events, [])
    assert(ui.buttons().every(item => !item.props.disabled))
  } finally { ui.app.unmount() }
})
