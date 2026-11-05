/* Official preview contracts; no real account, audio download or collection write. */
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
  instance._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file)
  return instance.exports
}
const directory = 'src/main/modules/platformAccounts/providers/'
const qq = load(`${directory}qq.ts`).qqProvider
const netease = load(`${directory}netease.ts`, { 'NeteaseCloudMusicApi/util/crypto': { weapi: value => value } }).neteaseProvider
const track = { id: 'tx_test', source: 'tx', name: 'Test', singer: 'Singer', interval: '03:00', meta: { songId: 'test', strMediaMid: 'media', albumName: '', qualitys: [], _qualitys: {} } }
const context = body => ({ cookies: async() => ({}), session: { fetch: async(url, options) => new Response(JSON.stringify(typeof body === 'function' ? body(url, options) : body), { headers: { 'Content-Type': 'application/json' } }) } })

async function main() {
  const wy = { ...track, id: 'wy_1', source: 'wy', meta: { ...track.meta, songId: 1, isVip: true } }
  const item = { id: 1, url: 'https://audio.example.test/preview.mp3', br: 128000, level: 'standard', expi: 300 }
  const preview = await netease.musicUrl(context({ code: 200, data: [{ ...item, freeTrialInfo: { start: 0, end: 30 } }] }), wy, 'auto')
  assert.equal(preview.isTrial, true)
  assert.equal(preview.type, '128k')
  const entitled = await netease.musicUrl(context({ code: 200, data: [{ ...item, freeTrialInfo: null }] }), wy, 'auto')
  assert.equal(entitled.isTrial, false, 'VIP metadata does not mean an entitled full stream is a preview')
  await assert.rejects(netease.musicUrl(context({ code: 200, data: [{ ...item, url: null, freeTrialInfo: { start: 0, end: 30 } }] }), wy, 'auto'), /没有返回/)
  const neteaseRequests = []
  const standardPreview = await netease.musicUrl(context((_url, options) => {
    const params = Object.fromEntries(new URLSearchParams(options.body))
    neteaseRequests.push(params)
    return { code: 200, data: [{ ...item, url: params.level === 'standard' && params.encodeType === 'mp3' ? item.url : null, freeTrialInfo: { start: 0, end: 30 } }] }
  }), wy, 'flac')
  assert.equal(standardPreview.isTrial, true, 'a denied premium tier still falls back to the official standard preview')
  assert.deepEqual(neteaseRequests.map(params => [params.level, params.encodeType]), [['lossless', 'flac'], ['standard', 'mp3']])
  const standardRequests = []
  await netease.musicUrl(context((_url, options) => {
    standardRequests.push(Object.fromEntries(new URLSearchParams(options.body)))
    return { code: 200, data: [{ ...item, freeTrialInfo: { start: 0, end: 30 } }] }
  }), wy, '128k')
  assert.equal(standardRequests.length, 1, 'standard playback does not issue a redundant fallback request')
  assert.equal(standardRequests[0].encodeType, 'mp3')

  let requests = 0
  const qqContext = context((_url, options) => {
    const names = JSON.parse(options.body).req.param.filename
    requests++
    return { req: { data: { sip: ['https://stream.example.test/'], midurlinfo: names.map(filename => ({ filename, purl: filename.startsWith('M500') ? 'M500media.mp3' : 'RS02preview.mp3' })) } } }
  })
  const lowerFull = await qq.musicUrl(qqContext, track, 'flac')
  assert.equal(requests, 2)
  assert.equal(lowerFull.isTrial, undefined)
  assert.equal(lowerFull.type, '128k')
  assert.match(lowerFull.url, /M500/)
  const downgraded = await qq.musicUrl(context({ req: { data: { midurlinfo: [{ filename: 'F000media.flac', purl: 'M500media.mp3' }] } } }), track, 'flac')
  assert.equal(downgraded.type, '128k', 'report actual returned encoding rather than requested filename')
  const qqTrial = await qq.musicUrl(context((_url, options) => ({ req: { data: { midurlinfo: JSON.parse(options.body).req.param.filename.map(filename => ({ filename, purl: 'RS02preview.mp3' })) } } })), track, 'flac')
  assert.equal(qqTrial.isTrial, true)
  assert.equal(qqTrial.qualityLabel, '试听音频（平台提供）')
  const retainedTrial = await qq.musicUrl(context((_url, options) => ({ req: { data: { midurlinfo: JSON.parse(options.body).req.param.filename.map(filename => ({ filename, purl: filename.startsWith('F000') ? 'RS02preview.mp3' : '' })) } } })), track, 'flac')
  assert.equal(retainedTrial.isTrial, true, 'retain the official preview when lower tiers are denied')
  await assert.rejects(qq.musicUrl(context({ req: { data: { midurlinfo: [] } } }), track, '128k'), /没有返回/)
  for (const file of [{}, { size_flac: 1000 }]) {
    const requests = []
    const autoPreview = await qq.musicUrl(context((_url, options) => {
      const request = JSON.parse(options.body).req
      if (request.module === 'music.pf_song_detail_svr') return { code: 0, req: { code: 0, data: { track_info: { file } } } }
      requests.push(request.param.filename)
      return { req: { data: { midurlinfo: request.param.filename.map(filename => ({ filename, purl: filename.startsWith('M500') ? 'RS02preview.mp3' : '' })) } } }
    }), track, 'auto')
    assert.equal(autoPreview.isTrial, true, 'missing or premium-only quality metadata must not exclude the official standard preview')
    assert.equal(requests.length, 1)
    assert.ok(requests[0].includes('M500media.mp3'))
  }
  const previewCalls = []
  const previewDetails = { mid: 'test', type: 0, action: { switch: 1 << 14 }, vs: ['preview-media'], file: { media_mid: 'full-media', size_try: 960887 } }
  let previewPurl = 'RS02preview-media.mp3?fromtag=0'
  let previewSongmid = 'test'
  const explicitPreviewContext = context((_url, options) => {
    const request = JSON.parse(options.body).req
    previewCalls.push(request)
    if (request.module === 'music.pf_song_detail_svr') return { code: 0, req: { code: 0, data: { track_info: previewDetails } } }
    if (request.module === 'music.vkey.GetEVkey') return { code: 0, req: { code: 0, data: { sip: ['https://preview.example.test/'], midurlinfo: [{ songmid: previewSongmid, purl: previewPurl }] } } }
    return { req: { data: { midurlinfo: [] } } }
  })
  const explicitPreview = await qq.musicUrl(explicitPreviewContext, track, '128k')
  assert.equal(explicitPreview.isTrial, true, 'an explicitly requested official RS02 stream remains available after full stream failure')
  assert.equal(explicitPreview.url, 'https://preview.example.test/RS02preview-media.mp3?fromtag=0')
  const previewRequest = previewCalls.find(request => request.module === 'music.vkey.GetEVkey')
  assert.equal(previewRequest.method, 'GetUrl')
  assert.deepEqual(previewRequest.param.filename, ['RS02preview-media.mp3'], 'the audition uses vs[0], which may differ from the full audio media ID')
  assert.deepEqual(previewRequest.param.songmid, ['test'])
  previewSongmid = 'another-song'
  await assert.rejects(qq.musicUrl(explicitPreviewContext, track, '128k'), /没有返回/, 'a returned preview for a different song is rejected')
  previewSongmid = undefined
  assert.equal((await qq.musicUrl(explicitPreviewContext, track, '128k')).isTrial, true, 'a single official result may omit its song ID')
  previewSongmid = 'test'
  previewCalls.length = 0
  previewPurl = ''
  await assert.rejects(qq.musicUrl(explicitPreviewContext, track, '128k'), /没有返回/, 'an advertised audition with an empty URL must not produce a guessed URL')
  previewDetails.action.switch = 0
  previewCalls.length = 0
  await assert.rejects(qq.musicUrl(explicitPreviewContext, track, '128k'), /没有返回/)
  assert.equal(previewCalls.some(request => request.module === 'music.vkey.GetEVkey'), false, 'a stored trial file does not override the platform audition permission')
  previewDetails.action.switch = 1 << 14
  previewDetails.file.size_try = 0
  previewCalls.length = 0
  await assert.rejects(qq.musicUrl(explicitPreviewContext, track, '128k'), /没有返回/)
  assert.equal(previewCalls.some(request => request.module === 'music.vkey.GetEVkey'), false, 'songs without an official preview resource do not issue a preview request')
  let fullRequests = 0
  const fullOnly = await qq.musicUrl(context((_url, options) => {
    fullRequests++
    assert.equal(JSON.parse(options.body).req.module, 'vkey.GetVkeyServer', 'an available full stream does not request preview metadata or URL')
    return { req: { data: { midurlinfo: [{ purl: 'M500media.mp3' }] } } }
  }), track, '128k')
  assert.equal(fullOnly.isTrial, undefined)
  assert.equal(fullRequests, 1)

  let accepted
  let response = { ...qqTrial, musicInfo: track, platform: 'QQ 音乐' }
  let resolveArgs
  const online = load('src/renderer/core/music/online.ts', {
    '@renderer/store/list/action': {},
    '@renderer/ui/services/platformPlayback': {
      preferredQuality: { value: 'auto' },
      resolvePlatformStream: async(...args) => { resolveArgs = args; return response },
      acceptStream: (_track, stream) => { accepted = stream },
    },
    // Media-duration validation has its own suite; this contract isolates the
    // platform-provided rights, quality fallback and preview metadata.
    '@renderer/ui/services/streamValidation': { readStreamDuration: async() => 180, isTruncatedStream: () => false },
    '@renderer/utils/ipc': {}, './utils': {},
  })
  assert.match(await online.getMusicUrl({ musicInfo: track, isRefresh: false }), /RS02/)
  assert.equal(accepted.isTrial, true, 'renderer preserves the complete resolver result and preview metadata')
  const rejectedUrls = [response.url]
  response = { url: 'https://audio.example.test/imported-full.mp3', type: '128k', platform: 'Imported fixture', musicInfo: track }
  assert.match(await online.getMusicUrl({ musicInfo: track, isRefresh: true, rejectedUrls }), /imported-full/)
  assert.equal(accepted.isTrial, undefined)
  assert.deepEqual(resolveArgs, [track, true, true, 'auto', { rejectedUrls }], 'media failures reach the single main-process source chain')
  const qs = { ...track, source: 'qs' }
  await online.getMusicUrl({ musicInfo: qs, isRefresh: false, allowToggleSource: false })
  assert.deepEqual(resolveArgs, [qs, false, false, 'auto', { rejectedUrls: [] }])
  console.log('Official preview contracts passed (Netease/QQ rights, quality fallback, full-stream priority, trial state).')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
