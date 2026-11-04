/* Legacy playback IPC must not erase previews; isolated provider/IPC mocks only. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(relative, dependencies = {}) {
  const file = path.join(root, relative)
  const instance = new Module(file, module)
  instance.filename = file
  instance.paths = Module._nodeModulePaths(path.dirname(file))
  const nativeRequire = instance.require.bind(instance)
  instance.require = name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    if (name.startsWith('@common/')) return load(`src/common/${name.slice(8)}.ts`)
    return nativeRequire(name)
  }
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, file)
  return instance.exports
}
const handlers = new Map()
const session = { cookies: { get: async() => [] }, setPermissionRequestHandler() {} }
let stream = { url: 'https://example.test/preview.mp3', type: '128k', isTrial: true }
function provider(id, source) {
  return { id, source, name: id, loginUrl: 'https://example.test/', domains: ['example.test'], musicUrl: async() => stream }
}
const resolver = load('src/main/modules/platformAccounts/playback.ts')
const index = load('src/main/modules/platformAccounts/index.ts', {
  electron: { app: { getPath: () => root }, session: { fromPartition: () => session } },
  'node:fs/promises': { readFile: async() => { throw Error('no cache') }, writeFile: async() => {}, rename: async() => {} },
  '@common/mainIpc': { mainHandle: (name, handler) => handlers.set(name, handler) },
  '@main/modules/winMain/main': {},
  './matching': load('src/common/platformMatching.ts'),
  './bilibiliLocalLibrary': { createBilibiliLocalLibrary: () => ({ init: async() => {}, tracks: (_owner, tracks) => tracks, visible: () => true, detail: value => value }) },
  './providers/qq': { qqProvider: provider('qq', 'tx') },
  './providers/netease': { neteaseProvider: provider('netease', 'wy') },
  './providers/kugou': { kugouProvider: provider('kugou', 'kg') },
  './providers/kuwo': { kuwoProvider: provider('kuwo', 'kw') },
  './providers/migu': { miguProvider: provider('migu', 'mg') },
  './providers/bilibili': { bilibiliProvider: provider('bilibili', 'bi') },
  './providers/qishui': { default: provider('qishui', 'qs'), __esModule: true },
  './providers/bodian': { default: provider('bodian', 'bo'), __esModule: true },
  './qishuiLogin': {},
  './qishuiPassport': {},
  './qishuiLoginDiagnostics': { createQishuiLoginDiagnosticWriter: () => () => {} },
  './bodianLogin': {},
  './nativeLogin': {},
  './navigation': { registerAccountSession() {} },
  './playback': resolver,
  '../userApi/playback': { getImportedPlaybackSources: () => [] },
})
global.lx = { appSetting: { 'player.preferredSource': 'auto' } }
index.default()
const invoke = async(channel, params) => handlers.get(channel)({ params })
const platform = load('src/renderer/utils/musicSdk/platform.js', { electron: { ipcRenderer: { invoke } } })
const customStream = { url: 'https://example.test/custom-full.mp3', type: '128k' }
let customCalls = 0
function sdk(source) {
  const empty = { default: {}, __esModule: true }
  const dependencies = Object.fromEntries(['./leaderboard', './lyric', './songList', './musicSearch', './hotSearch', './comment', './musicInfo'].map(name => [name, empty]))
  dependencies['../platform'] = platform
  dependencies['../api-source'] = { apis: requested => {
    assert.equal(requested, source)
    return { getMusicUrl: () => ({ promise: Promise.resolve().then(() => { customCalls++; return customStream }) }) }
  } }
  return load(`src/renderer/utils/musicSdk/${source}/index.js`, dependencies).default
}
async function main() {
  const track = { id: 'tx_song', source: 'tx', name: 'Song', singer: 'Singer', meta: { songId: 'song', albumName: '', qualitys: [], _qualitys: {} } }
  await assert.rejects(invoke('platform_accounts_music_url', { source: 'tx', songId: 'song' }), /试听音频/)
  const modern = await invoke('platform_playback_resolve', { track, allowToggleSource: false })
  assert.equal(modern.isTrial, true, 'modern resolver retains the explicit official-preview status')
  assert.equal(modern.url, stream.url)
  for (const source of ['tx', 'wy']) {
    assert.deepEqual(await sdk(source).getMusicUrl({ songmid: 'song' }, '128k').promise, customStream)
  }
  assert.equal(customCalls, 2, 'legacy SDK really tries custom full sources after preview rejection')
  stream = { url: 'https://example.test/account-full.mp3', type: '320k', isTrial: false }
  const full = await invoke('platform_accounts_music_url', { source: 'wy', songId: 'song' })
  assert.deepEqual(full, stream)
  assert.deepEqual(await sdk('wy').getMusicUrl({ songmid: 'song' }, '320k').promise, stream)
  assert.equal(customCalls, 2, 'entitled full streams keep the existing direct-account path')
  console.log('Legacy IPC rejects previews, modern IPC retains them, and QQ/Netease SDK full fallback contracts passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
