const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

function load(relative, overrides) {
  const filename = path.resolve(__dirname, '..', relative)
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const subject = new Module(filename, module)
  subject.filename = filename
  subject.paths = module.paths
  const nativeRequire = subject.require.bind(subject)
  subject.require = id => overrides(id, nativeRequire)
  subject._compile(compiled, filename)
  return subject.exports
}

const { getNeteaseHeartbeat } = load('src/main/modules/platformAccounts/providers/netease.ts', (id, nativeRequire) => {
  if (id === '@common/platformPlayback') return load('src/common/platformPlayback.ts', (id, require) => require(id))
  if (id === 'NeteaseCloudMusicApi/util/crypto') return { __esModule: true, default: { weapi: data => ({ payload: JSON.stringify(data) }) } }
  if (id === '@common/musicAccess') return { songVip: () => false }
  if (id === '@common/musicSubtitle') return { songSubtitle: () => '' }
  return nativeRequire(id)
})
const profile = { id: '100', nickname: '测试用户', avatar: '' }
const likedPlaylist = { id: 900, specialType: 5, creator: { userId: 100 } }
const song = (id, name = `歌曲 ${id}`) => ({ id, name, dt: 185000, ar: [{ name: '歌手' }], al: { id: 700, name: '专辑', picUrl: 'https://example.com/cover.jpg' } })

function providerFixture(actions, cookies = { MUSIC_U: 'fixture-session', __csrf: 'fixture-csrf' }) {
  const requests = []
  return {
    requests,
    context: {
      cookies: async() => cookies,
      session: {
        async fetch(url, options) {
          const data = JSON.parse(new URLSearchParams(options.body).get('payload'))
          requests.push({ url, data, options })
          const action = actions.shift()
          assert.ok(action, 'unexpected upstream request')
          const body = typeof action === 'function' ? await action(url, data) : action
          return { ok: true, json: async() => ({ code: 200, ...body }) }
        },
      },
    },
  }
}

test('current NetEase seed requests the full smart queue and converts unique songs', async() => {
  const f = providerFixture([
    { playlist: [{ ...likedPlaylist, creator: { userId: 999 } }, likedPlaylist] },
    { data: [{ songInfo: song(10) }, { songInfo: song(10) }, null, { songInfo: song(0) }, { songInfo: song(20, '') }, { songInfo: song(30) }] },
  ])
  const result = await getNeteaseHeartbeat(f.context, profile, { seedId: 51 })
  assert.equal(result.accountId, '100')
  assert.equal(result.playlistId, '900')
  assert.equal(result.seedId, '51')
  assert.deepEqual(result.tracks.map(track => track.id), ['wy_10', 'wy_30'])
  assert.equal(result.tracks[0].source, 'wy')
  assert.equal(result.tracks[0].singer, '歌手')
  assert.equal(result.tracks[0].interval, '03:05')
  assert.deepEqual(result.tracks[0].meta.qualitys, [{ type: '128k', size: null }])
  assert.equal(f.requests.length, 2)
  assert.match(f.requests[1].url, /^https:\/\/music\.163\.com\/weapi\/playmode\/intelligence\/list\?csrf_token=/)
  assert.deepEqual(f.requests[1].data, { songId: '51', type: 'fromPlayOne', playlistId: '900', startMusicId: '51', count: 1, csrf_token: 'fixture-csrf' })
  assert.equal(f.requests[1].options.method, 'POST')
})

test('missing or invalid seed falls back to valid liked IDs and finds paginated special playlist', async() => {
  const f = providerFixture([
    { ids: [null, 0, -1, '52', '53'] },
    { playlist: [{ id: 800, creator: { userId: 100 }, specialType: 0 }], more: true },
    { playlist: [likedPlaylist] },
    { data: [{ songInfo: song(10) }] },
  ])
  const result = await getNeteaseHeartbeat(f.context, profile, { seedId: 'not-a-song' })
  assert.ok(['52', '53'].includes(result.seedId))
  assert.equal(f.requests[0].data.uid, '100')
  assert.equal(f.requests[2].data.offset, 1)
  assert.equal(f.requests[3].data.songId, result.seedId)
})

test('logged out users never call the upstream API', async() => {
  const f = providerFixture([], {})
  await assert.rejects(getNeteaseHeartbeat(f.context, profile, { seedId: 51 }), /登录网易云音乐/)
  assert.equal(f.requests.length, 0)
})

test('empty likes, unavailable liked playlist, empty queue and expired login give actionable errors', async() => {
  const empty = providerFixture([{ ids: [] }])
  await assert.rejects(getNeteaseHeartbeat(empty.context, profile), /喜欢一些歌曲/)
  const noList = providerFixture([{ playlist: [{ ...likedPlaylist, creator: { userId: 999 } }] }])
  await assert.rejects(getNeteaseHeartbeat(noList.context, profile, { seedId: 51 }), /未找到网易云喜欢/)
  const noSongs = providerFixture([{ playlist: [likedPlaylist] }, { data: [] }])
  await assert.rejects(getNeteaseHeartbeat(noSongs.context, profile, { seedId: 51 }), /没有返回心动歌曲/)
  const expired = providerFixture([{ code: 301 }])
  await assert.rejects(getNeteaseHeartbeat(expired.context, profile, { seedId: 51 }), /登录已失效/)
})

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise(_resolve => { resolve = _resolve })
  return { promise, resolve }
}

function ipcFixture(authenticated = true) {
  const handlers = new Map()
  const events = []
  let currentProfile = { ...profile }
  let profileError = null
  let heartbeat = async(_context, account, params) => ({ accountId: account.id, seedId: String(params.seedId ?? '51'), playlistId: '900', tracks: [] })
  let calls = 0
  const ses = {
    cookies: { async get() { return authenticated ? [{ name: 'MUSIC_U', value: 'fixture-session' }] : [] } },
    setPermissionRequestHandler() {},
    async clearStorageData() { authenticated = false },
  }
  const provider = { id: 'netease', name: '网易云音乐', source: 'wy', domains: ['music.163.com'], loginUrl: 'https://music.163.com/', async profile() { if (profileError) throw profileError; return currentProfile } }
  const subject = load('src/main/modules/platformAccounts/index.ts', (id, nativeRequire) => {
    if (id === 'electron') return { app: { getPath: () => 'fixture-cache' }, BrowserWindow: function() {}, session: { fromPartition: () => ses } }
    if (id === 'node:fs/promises') return { __esModule: true, default: { readFile: async() => '[]', writeFile: async() => {}, rename: async() => {} } }
    if (id === '@common/mainIpc') return { mainHandle: (channel, handler) => handlers.set(channel, handler) }
    if (id === '@main/modules/winMain/main') return { sendEvent: (...args) => events.push(args) }
    if (id === './providers/netease') return { neteaseProvider: provider, getNeteaseHeartbeat: (...args) => { calls++; return heartbeat(...args) } }
    if (id.startsWith('./providers/')) {
      const name = id.slice('./providers/'.length)
      const other = { id: name, source: name, name, loginUrl: 'https://example.com/', domains: [], webOnly: true }
      return { __esModule: true, default: other, [`${name}Provider`]: other }
    }
    if (id === './navigation') return { registerAccountSession() {} }
    if (id === './playback') return { createPlaybackResolver: () => ({}) }
    if (id === '../userApi/playback') return { getImportedPlaybackSources: () => [] }
    if (id === './matching') return { aggregateFavorites: () => [] }
    if (id === './bilibiliLocalLibrary') return { createBilibiliLocalLibrary: () => ({ init: async() => {}, tracks: (_owner, tracks) => tracks, visible: () => true, detail: value => value }) }
    if (id === './qishuiLoginDiagnostics') return { createQishuiLoginDiagnosticWriter: () => () => {} }
    if (id === './qishuiLogin' || id === './qishuiPassport' || id === './bodianLogin' || id === './nativeLogin') return {}
    return nativeRequire(id)
  })
  subject.default()
  return {
    events,
    invoke: (channel, params) => handlers.get(channel)({ params }),
    setHeartbeat: value => { heartbeat = value },
    setProfile: value => { currentProfile = value },
    setProfileError: value => { profileError = value },
    calls: () => calls,
  }
}

test('IPC enforces login and refreshes expired account state before returning an error', async() => {
  const offline = ipcFixture(false)
  await assert.rejects(offline.invoke('platform_netease_heartbeat', { seedId: 51 }), /登录网易云音乐/)
  assert.equal(offline.calls(), 0)
  const expired = ipcFixture()
  await expired.invoke('platform_accounts_snapshot')
  expired.setProfileError(new Error('登录已失效，请重新登录'))
  await assert.rejects(expired.invoke('platform_netease_heartbeat', { seedId: 51 }), /登录已失效/)
  const state = await expired.invoke('platform_accounts_snapshot')
  assert.equal(state.accounts.find(account => account.platform === 'netease').connected, false)
  assert.equal(expired.calls(), 0)
  assert.ok(expired.events.some(([channel]) => channel === 'platform_accounts_changed'))
})

test('IPC returns the generated queue and rejects malformed requests', async() => {
  const f = ipcFixture()
  assert.deepEqual(await f.invoke('platform_netease_heartbeat', { seedId: 51 }), { accountId: '100', seedId: '51', playlistId: '900', tracks: [] })
  await assert.rejects(f.invoke('platform_netease_heartbeat', '51'), /无效的心动模式参数/)
  assert.equal(f.calls(), 1)
})

test('IPC discards a queue generated before logout and rejects silent account changes', async() => {
  const f = ipcFixture()
  await f.invoke('platform_accounts_snapshot')
  const wait = deferred()
  f.setHeartbeat(async() => wait.promise)
  const request = f.invoke('platform_netease_heartbeat', { seedId: 51 })
  await tick()
  assert.equal(f.calls(), 1)
  const logout = f.invoke('platform_accounts_logout', 'netease')
  await tick()
  wait.resolve({ accountId: '100', seedId: '51', playlistId: '900', tracks: [] })
  await assert.rejects(request, /账号已更改/)
  await logout

  const switched = ipcFixture()
  await switched.invoke('platform_accounts_snapshot')
  switched.setProfile({ ...profile, id: '200' })
  await assert.rejects(switched.invoke('platform_netease_heartbeat', { seedId: 51 }), /账号已更改/)
  assert.equal(switched.calls(), 0)
})
