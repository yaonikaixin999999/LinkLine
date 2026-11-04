import fs from 'node:fs/promises'
import type { PlatformPlaylist, PlatformPlaylistDetail } from '@common/platformAccounts'

interface Exclusions { ownerId: string, playlists: string[], tracks: string[] }
export interface BilibiliLocalRemoval { ownerId: string, playlistId?: string, trackIds?: string[] }
const validOwner = (value: unknown): value is string => typeof value === 'string' && /^\d{1,30}$/.test(value)
const validPlaylist = (value: unknown): value is string => typeof value === 'string' && /^bilibili:\d{1,30}$/.test(value)
const validTrack = (value: unknown): value is string => typeof value === 'string' && /^bi_BV[\da-z]{10}$/i.test(value)
const replaceFile = async(temporary: string, target: string) => {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temporary, target); return } catch (error) {
      // Windows indexers/antivirus can briefly hold the destination open.
      // Keep the original file intact and retry only these transient failures.
      if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 100))
    }
  }
}

/** Local exclusions only. This module deliberately has no platform/network API. */
export const createBilibiliLocalLibrary = (file: () => string) => {
  const owners = new Map<string, Exclusions>()
  let initialized: Promise<void> | undefined
  let tail = Promise.resolve()
  const init = async() => {
    initialized ??= (async() => {
      let body: string
      try { body = await fs.readFile(file(), 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      const data = JSON.parse(body)
      if (data?.version !== 1 || !Array.isArray(data.owners)) throw new Error('哔哩哔哩本地移除记录格式无效')
      for (const value of data.owners) {
        if (!validOwner(value?.ownerId) || !Array.isArray(value.playlists) || !Array.isArray(value.tracks)) continue
        owners.set(value.ownerId, { ownerId: value.ownerId, playlists: [...new Set<string>(value.playlists.filter(validPlaylist))], tracks: [...new Set<string>(value.tracks.filter(validTrack))] })
      }
    })()
    await initialized
  }
  const tracks = (ownerId: string, list: LX.Music.MusicInfoOnline[]) => {
    const excluded = new Set(owners.get(ownerId)?.tracks ?? [])
    return list.filter(track => track.source !== 'bi' || !excluded.has(track.id))
  }
  const visible = (playlist: PlatformPlaylist) => playlist.platform !== 'bilibili' || !owners.get(playlist.ownerId)?.playlists.includes(playlist.id)
  const detail = (value: PlatformPlaylistDetail): PlatformPlaylistDetail => {
    if (value.playlist.platform !== 'bilibili') return value
    if (!visible(value.playlist)) throw new Error('此歌单已从 LinkLine 移除')
    const list = tracks(value.playlist.ownerId, value.tracks)
    return { ...value, tracks: list, playlist: { ...value.playlist, count: list.length } }
  }
  const remove = async(params: BilibiliLocalRemoval): Promise<void> => {
    if (!params || !validOwner(params.ownerId) || (params.playlistId ? !validPlaylist(params.playlistId) || params.trackIds !== undefined : !Array.isArray(params.trackIds) || !params.trackIds.length || params.trackIds.length > 10000 || !params.trackIds.every(validTrack))) throw new Error('无效的哔哩哔哩本地移除请求')
    await init()
    const operation = tail.then(async() => {
      const previous = owners.get(params.ownerId)
      const entry: Exclusions = {
        ownerId: params.ownerId,
        playlists: [...new Set([...(previous?.playlists ?? []), ...(params.playlistId ? [params.playlistId] : [])])],
        tracks: [...new Set([...(previous?.tracks ?? []), ...(params.trackIds ?? [])])],
      }
      const next = new Map(owners)
      next.set(params.ownerId, entry)
      try {
        await fs.writeFile(`${file()}.tmp`, JSON.stringify({ version: 1, owners: [...next.values()] }), 'utf8')
        await replaceFile(`${file()}.tmp`, file())
      } catch (error) {
        await fs.rm(`${file()}.tmp`, { force: true }).catch(() => {})
        throw error
      }
      owners.set(params.ownerId, entry)
    })
    tail = operation.catch(() => {})
    await operation
  }
  return { init, tracks, visible, detail, remove }
}
