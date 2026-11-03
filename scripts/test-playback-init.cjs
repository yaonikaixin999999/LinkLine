/* First playback must not wait for unrelated account/profile endpoints. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise(_resolve => { resolve = _resolve })
  return { promise, resolve }
}
const track = source => ({ id: `${source}_song`, source, name: 'Song', singer: 'Singer', meta: { songId: 'song', albumName: '', qualitys: [], _qualitys: {} } })

function fixture(profiles = {}) {
  const handlers = new Map()
  const profileCalls = []
  const sessions = new Map()
  const streamRequests = []
  let getStates
  const bySource = { tx: 'qq', wy: 'netease', qs: 'qishui', bo: 'bodian', kg: 'kugou', kw: 'kuwo', mg: 'migu', bi: 'bilibili' }
  const providers = Object.fromEntries(Object.entries(bySource).map(([source, id]) => [id, {
    id,
    source,
    name: id,
    loginUrl: 'https://example.test/',
    domains: [],
    authenticated: () => true,
    profile: async() => { profileCalls.push(id); return profiles[id] ? profiles[id]() : { id: `${id}-account` } },
    musicUrl: async(_context, musicInfo) => {
      if (musicInfo) streamRequests.push(musicInfo)
      return { url: `https://example.test/${id}.mp3`, type: '128k' }
    },
  }]))
  const dependencies = {
    electron: {
      app: { getPath: () => root },
      session: {
        fromPartition: name => {
          if (!sessions.has(name)) sessions.set(name, { cookies: { get: async() => [{ name: 'fixture', value: 'session' }] }, setPermissionRequestHandler() {} })
          return sessions.get(name)
        },
      },
    },
    'node:fs/promises': { readFile: async() => '[]', writeFile: async() => {}, rename: async() => {} },
    '@common/mainIpc': { mainHandle: (channel, handler) => handlers.set(channel, handler) },
    '@main/modules/winMain/main': {},
    './matching': { aggregateFavorites: () => [] },
    './bilibiliLocalLibrary': { createBilibiliLocalLibrary: () => ({ init: async() => {}, tracks: (_owner, tracks) => tracks, visible: () => true, detail: value => value }) },
    './navigation': { registerAccountSession() {} },
    './playback': {
      createPlaybackResolver: readStates => {
        getStates = readStates
        return {
          resolve: async value => {
            const state = readStates().find(state => state.provider.source === value.source)
            return { ...(await state.provider.musicUrl()), connected: state.account.connected }
          },
          qualitys: async() => ['128k'],
        }
      },
    },
    './qishuiLogin': {},
    './qishuiPassport': {},
    './qishuiLoginDiagnostics': { createQishuiLoginDiagnosticWriter: () => () => {} },
    './bodianLogin': {},
    './nativeLogin': {},
    '../userApi/playback': { getImportedPlaybackSources: () => [] },
  }
  for (const [id, provider] of Object.entries(providers)) {
    dependencies[`./providers/${id}`] = ['qishui', 'bodian'].includes(id) ? { default: provider, __esModule: true } : { [`${id}Provider`]: provider }
  }
  const filename = path.join(root, 'src/main/modules/platformAccounts/index.ts')
  const subject = new Module(filename, module)
  subject.filename = filename
  subject.paths = Module._nodeModulePaths(path.dirname(filename))
  const nativeRequire = subject.require.bind(subject)
  subject.require = name => Object.hasOwn(dependencies, name) ? dependencies[name] : nativeRequire(name)
  subject._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)
  subject.exports.default()
  return {
    profileCalls,
    sessions,
    streamRequests,
    states: () => getStates(),
    invoke: (channel, params) => handlers.get(channel)({ params }),
  }
}

async function main() {
  global.lx = { appSetting: { 'player.preferredSource': 'auto' } }
  for (const preferred of ['imported:fixture', 'tx']) {
    global.lx.appSetting['player.preferredSource'] = preferred
    const direct = fixture({ netease: () => new Promise(() => {}) })
    let ready = false
    const request = direct.invoke('platform_playback_resolve', { track: track('wy') }).then(() => { ready = true })
    await tick()
    assert.equal(ready, true, `${preferred} starts without verifying the original account`)
    await request
    assert.deepEqual(direct.profileCalls, [])
  }
  global.lx.appSetting['player.preferredSource'] = 'auto'
  const direct = fixture({ netease: () => new Promise(() => {}) })
  await direct.invoke('platform_playback_resolve', { track: track('wy'), allowToggleSource: false })
  await direct.invoke('platform_accounts_music_url', { source: 'wy', songId: 'song' })
  await direct.invoke('platform_playback_qualitys', track('wy'))
  assert.deepEqual(direct.profileCalls, [], 'direct source-only URLs and qualities never need profile validation')
  const qishui = direct.states().find(state => state.provider.id === 'qishui')
  assert.equal(qishui.context.playbackSession, direct.sessions.get('persist:win-main'), 'Qishui audio probes must share the actual player partition and its proxy settings')
  assert.equal(qishui.context.session, direct.sessions.get('persist:linkline-account-qishui'), 'Public metadata and account requests keep their own partition')
  assert.equal(direct.states().find(state => state.provider.id === 'netease').context.playbackSession, undefined)
  await direct.invoke('platform_accounts_music_url', { source: 'qs', songId: 'clip', qishuiMediaType: 'ugc_clip' })
  assert.equal(direct.streamRequests.at(-1).meta.qishuiMediaType, 'ugc_clip', 'The legacy playback route must retain known original-sound types without relying on SEO recovery')
  await direct.invoke('platform_accounts_music_url', { source: 'qs', songId: 'clip', qishuiMediaType: 'ugc_video' })
  assert.equal(direct.streamRequests.at(-1).meta.qishuiMediaType, undefined)
  await direct.invoke('platform_accounts_music_url', { source: 'wy', songId: 'song', qishuiMediaType: 'ugc_clip' })
  assert.equal(direct.streamRequests.at(-1).meta.qishuiMediaType, undefined)

  const unrelated = deferred()
  const f = fixture({ qq: () => unrelated.promise })
  let snapshotDone = false
  const snapshot = f.invoke('platform_accounts_snapshot').then(result => { snapshotDone = true; return result })
  const stream = await f.invoke('platform_playback_resolve', { track: track('wy') })
  assert.equal(stream.connected, true, 'the original account is verified before priority is evaluated')
  assert.equal(snapshotDone, false, 'ordinary account snapshots still wait for full initialization')
  assert.equal(f.profileCalls.filter(id => id === 'netease').length, 1, 'snapshot and playback share the account check')
  assert.deepEqual(await f.invoke('platform_playback_qualitys', track('wy')), ['128k'])
  assert.match((await f.invoke('platform_accounts_music_url', { source: 'wy', songId: 'song' })).url, /netease/)
  assert.equal(snapshotDone, false, 'legacy URL and quality requests also ignore unrelated profiles')
  unrelated.resolve({ id: 'qq-account' })
  assert.equal((await snapshot).accounts.every(account => account.connected), true)

  const delayed = deferred()
  const slow = fixture({ netease: () => delayed.promise })
  let completed = false
  const started = Date.now()
  const pending = slow.invoke('platform_playback_resolve', { track: track('wy') }).then(result => { completed = true; return result })
  await tick()
  assert.equal(completed, false, 'a normal source-account check is given time to establish priority')
  const fallback = await pending
  assert.equal(fallback.connected, false)
  assert.ok(Date.now() - started >= 1800, 'the profile check uses the bounded startup grace period')
  let secondDone = false
  const second = slow.invoke('platform_playback_resolve', { track: track('wy') }).then(() => { secondDone = true })
  await tick()
  assert.equal(secondDone, true, 'later songs never repeat the timeout for the same pending account check')
  await second
  const state = slow.states().find(state => state.provider.source === 'wy')
  state.generation++
  delayed.resolve({ id: 'expired-generation' })
  await tick()
  assert.equal(state.account.connected, false, 'a late profile from an old login generation cannot reconnect the account')
  assert.equal(state.account.profile, null)
  assert.deepEqual(slow.profileCalls, ['netease'], 'a playback-only startup never validates unrelated platforms')
  console.log('Playback startup bypasses unrelated profiles, shares source validation, and bounds slow source checks')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
