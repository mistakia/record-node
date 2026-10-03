// Playback of a replicated library's audio (chapter 7 /audio, chapter 8
// §8.6.5a) over real libp2p on loopback: GET fetches a blob B does not hold
// from A over bitswap and never pins it, HEAD stays local-only, and fetched
// blocks are evicted least recently used first under the byte cap, never
// while a pin covers them.

import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'

import { create_api_server, stop_api_server, type ApiServer } from '#api/index.ts'
import type { PeerConfig } from '#peer/config.ts'
import type { Peer } from '#peer/peer.ts'
import { create_fake_resolver } from '#test/api/fake-peer.ts'
import { create_libp2p_peers, dial_address } from '#test/helpers/libp2p.ts'
import { append_track, wait_until } from '#test/helpers/network.ts'

const peers = create_libp2p_peers()
const servers: ApiServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await stop_api_server(server)
  await peers.stop_all()
})

const MIB = 1024 * 1024

// A distinct random ASCII blob of exactly `bytes` bytes, so its leaves never
// dedupe against another's and its stored UTF-8 bytes are the string itself.
const audio_of = (bytes: number) => randomBytes(Math.ceil(bytes / 2)).toString('hex').slice(0, bytes)

// A holds the tracks; B replicates A's library and serves the API.
const replicated_pair = async ({ sizes, config = {} }: { sizes: number[], config?: Partial<PeerConfig> }) => {
  const a = await peers.start()
  const tracks = []
  for (const [index, size] of sizes.entries()) {
    const audio = audio_of(size)
    tracks.push({ ...await append_track({ peer: a, fingerprint: `AQADplayback${index}`, audio }), bytes: Buffer.from(audio) })
  }
  const b = await peers.start({ bootstrap: [await dial_address(a)] }, config)
  const address = a.identity().own_address
  await b.link_library({ address, alias: null })
  await wait_until(() => b.context.libraries.get(address)?.oplog.entries.size === sizes.length)
  await b.context.replication?.settled(address)
  const server = await create_api_server({ peer: b, resolve: create_fake_resolver({}), port: 0, log: false, validate_responses: true })
  servers.push(server)
  const audio_url = (cid: string) => `http://127.0.0.1:${server.port}/api/audio/${cid}`
  const head = async (cid: string) => (await fetch(audio_url(cid), { method: 'HEAD' })).status
  return { a, b, tracks, audio_url, head }
}

const local_on = async (peer: Peer, cid: string) => await peer.has_audio(cid)

describe('audio playback', () => {
  test('GET fetches a replicated track\'s audio from the peer, serves ranges, and pins nothing', async () => {
    const { b, tracks: [track], audio_url, head } = await replicated_pair({ sizes: [Math.floor(2.5 * MIB)] })
    if (track === undefined) throw new Error('no track')
    expect(await head(track.audio_cid)).toBe(404)

    const whole = await fetch(audio_url(track.audio_cid))
    expect(whole.status).toBe(200)
    expect(Buffer.from(await whole.arrayBuffer()).equals(track.bytes)).toBe(true)
    const ranged = await fetch(audio_url(track.audio_cid), { headers: { range: 'bytes=1048570-1048589' } })
    expect(ranged.status).toBe(206)
    expect(ranged.headers.get('content-range')).toBe(`bytes 1048570-1048589/${track.bytes.length}`)
    expect(Buffer.from(await ranged.arrayBuffer()).equals(track.bytes.subarray(1048570, 1048590))).toBe(true)

    // The fetched blob is now local, and still unpinned.
    expect(await head(track.audio_cid)).toBe(200)
    expect(await b.content_store.is_pinned(track.audio_cid)).toBe(false)
  })

  test('under the byte cap, unpinned fetched blobs are evicted oldest first and a pinned one never is', async () => {
    const size = Math.floor(1.5 * MIB)
    const { b, tracks, audio_url, head } = await replicated_pair({ sizes: [size, size, size], config: { audio_cache_max_bytes: 2 * MIB } })
    const [kept, evicted, latest] = tracks as [typeof tracks[number], typeof tracks[number], typeof tracks[number]]
    expect((await fetch(audio_url(kept.audio_cid))).status).toBe(200)
    expect(await head(kept.audio_cid)).toBe(200)
    // Adopting the track into B's own library pins its audio.
    await b.add_track(kept.content_cid)
    expect(await b.content_store.is_pinned(kept.audio_cid)).toBe(true)

    expect((await fetch(audio_url(evicted.audio_cid))).status).toBe(200)
    expect((await fetch(audio_url(latest.audio_cid))).status).toBe(200)
    expect(b.context.audio.cached_bytes()).toBeLessThanOrEqual(2 * MIB)
    expect(await local_on(b, kept.audio_cid)).toBe(true)
    expect(await local_on(b, evicted.audio_cid)).toBe(false)
    expect(await local_on(b, latest.audio_cid)).toBe(true)
    expect(await head(evicted.audio_cid)).toBe(404)
    expect(await head(latest.audio_cid)).toBe(200)
  })

  test('GET for audio no peer serves returns 404 once the fetch times out', async () => {
    const { audio_url } = await replicated_pair({ sizes: [1024], config: { audio_fetch_timeout_ms: 300 } })
    const unknown = await create_unserved_cid()
    const started = Date.now()
    const response = await fetch(audio_url(unknown))
    expect(response.status).toBe(404)
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})

// The CID of a blob imported into a store no peer can reach.
const create_unserved_cid = async () => {
  const { create_memory_content_store } = await import('#adapter/memory/content-store.ts')
  return await create_memory_content_store().import_blob(randomBytes(4096))
}
