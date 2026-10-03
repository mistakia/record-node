// Source dedup across URLs that share audio (§2.10, §6.4.2), and an unlink
// that a crash cuts short finishing at the next start (§4.6).

import { afterEach, describe, expect, test } from 'bun:test'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generate_key_pair } from '#identity/key-pair.ts'
import { data_paths } from '#peer/config.ts'
import { create_peer, start_peer, stop_peer, type Peer } from '#peer/peer.ts'
import type { ResolveUrl } from '#peer/resolver.ts'
import { preflight_bypassed } from '#test/helpers/ingest.ts'
import { stored_track } from '#test/helpers/library-manager.ts'
import { fixture_download, fixture_resolver, YOUTUBE_FIXTURE, YOUTUBE_URL } from '#test/helpers/resolver.ts'
import type { PeerEvent, TrackQuery } from '#types/peer.ts'

const QUERY: TrackQuery = { offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' }
const running: Peer[] = []

afterEach(async () => {
  for (const peer of running.splice(0)) await stop_peer(peer)
})

const start = async (options: Parameters<typeof create_peer>[0] = {}): Promise<Peer> => {
  const peer = await create_peer({ ...options, config: { allow_toolchain_mismatch: preflight_bypassed, ...options.config } })
  await start_peer(peer)
  running.push(peer)
  return peer
}

const stop = async (peer: Peer) => {
  running.splice(running.indexOf(peer), 1)
  await stop_peer(peer)
}

describe('url ingest dedup', () => {
  // URL B names another source whose stream is the same audio as URL A's.
  const URL_B = 'https://soundcloud.com/someone/same-audio'
  const youtube = fixture_resolver(YOUTUBE_FIXTURE)
  const resolve: ResolveUrl = async (url) => {
    const [entry] = await youtube(YOUTUBE_URL)
    if (entry === undefined) throw new Error('the youtube fixture resolved to nothing')
    return url === URL_B ? [{ ...entry, extractor: 'soundcloud', id: 'same-audio', webpage_url: URL_B }] : [entry]
  }

  test('a source that lands on audio the library holds is recorded, so its next request does not download', async () => {
    // Every download writes the same bytes, so both sources are one track.
    const audio_path = join(mkdtempSync(join(tmpdir(), 'record-dedup-test-')), 'tone.m4a')
    await fixture_download()({ url: 'fixture', output_path: audio_path })
    const urls: string[] = []
    const download = async ({ url, output_path }: { url: string, output_path: string }) => {
      urls.push(url)
      copyFileSync(audio_path, output_path)
    }
    const peer = await start({ resolve, download })
    const events: PeerEvent[] = []
    peer.subscribe((event) => { events.push(event) })
    const import_url = async (url: string) => {
      const { import_id } = await peer.import_url(url)
      for (let attempt = 0; attempt < 400; attempt++) {
        const finished = events.find(({ type, payload }) => type === 'import:finished' && (payload as { import_id: string }).import_id === import_id)
        if (finished !== undefined) return finished.payload
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error(`import of ${url} did not finish`)
    }

    expect(await import_url(YOUTUBE_URL)).toMatchObject({ track_count: 1, error_count: 0 })
    expect(await import_url(URL_B)).toMatchObject({ track_count: 1, error_count: 0 })
    expect(urls).toHaveLength(2)
    const { items, total } = await peer.list_tracks(QUERY)
    expect(total).toBe(1)
    expect(items[0]?.resolvers?.map(({ extractor, id }) => [extractor, id]))
      .toEqual([['soundcloud', 'same-audio'], ['youtube', 'iODdvJGpfIA']])

    expect(await import_url(URL_B)).toMatchObject({ track_count: 1, error_count: 0 })
    expect(await import_url(YOUTUBE_URL)).toMatchObject({ track_count: 1, error_count: 0 })
    expect(urls).toHaveLength(2)
    expect((await peer.list_tracks(QUERY)).total).toBe(1)
  })
})

describe('restartable unlink', () => {
  test('an unlink cut short after its marker is finished at the next start', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-unlink-test-'))
    const first = await start({ config: { data_dir } })
    const { libraries, content_store } = first.context
    // A second library held locally, with a track, linked from the own library.
    const writer = generate_key_pair()
    const other = await libraries.create_library({ name: 'other', type: 'recordstore', write_keys: [writer.public_key] })
    const address = other.chain.address
    const track = await stored_track({ content_store, fingerprint: 'AQAA-other', audio: 'audio held by the other library' })
    const entry = await libraries.append({ library_address: address, payload: track.payload, key_pair: writer })
    await first.link_library({ address, alias: 'other' })
    const held = [other.chain.cids.manifest, other.chain.cids.wrapper, other.chain.cids.write_list, entry.hash, track.content_cid, track.audio_cid]
    expect(await Promise.all(held.map(content_store.is_pinned))).toEqual(held.map(() => true))

    // The crash: the first unpin lands, the second never does.
    const unpin = content_store.unpin
    let unpins = 0
    content_store.unpin = async (cid) => {
      if (++unpins > 1) throw new Error('crash')
      await unpin(cid)
    }
    await expect(first.unlink_library(address)).rejects.toThrow('crash')
    content_store.unpin = unpin
    const state = () => JSON.parse(readFileSync(data_paths(data_dir).libraries, 'utf8')) as { heads: Record<string, string[]>, unlinking: string[] }
    expect(state().unlinking).toEqual([address])
    expect(state().heads[address]).toBeDefined()
    await stop(first)

    const second = await start({ config: { data_dir } })
    expect(state().unlinking).toEqual([])
    expect(state().heads[address]).toBeUndefined()
    expect(await Promise.all(held.map(second.content_store.is_pinned))).toEqual(held.map(() => false))
    expect(await second.get_library(address)).toBeUndefined()
    const own = second.context.libraries.get(second.identity().own_address)
    expect(await second.content_store.is_pinned(own?.chain.cids.manifest as string)).toBe(true)
  })
})
