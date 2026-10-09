// Artwork served by /images/{cid} (chapter 7) from real peers on a memory
// network: A ingests a file with an embedded cover and serves it; B fetches
// it from A without keeping the blocks; neither serves the audio blob or a
// blob over the cap.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { create_api_server, stop_api_server, type ApiServer } from '#api/index.ts'
import type { Peer } from '#peer/peer.ts'
import { IMAGE_MAX_BYTES } from '#peer/images.ts'
import { create_fake_resolver } from '#test/api/fake-peer.ts'
import { make_tagged_copy, scratch_dir } from '#test/helpers/ingest.ts'
import { create_memory_peers, wait_for_event } from '#test/helpers/network.ts'
import type { Track } from '#types/peer.ts'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const peers = create_memory_peers()
const servers: ApiServer[] = []
let a: Peer
let b: Peer
let track: Track

const serve = async (peer: Peer) => {
  const server = await create_api_server({ peer, resolve: create_fake_resolver({}), port: 0, log: false, validate_responses: true })
  servers.push(server)
  return (cid: string) => `http://127.0.0.1:${server.port}/api/images/${cid}`
}

beforeAll(async () => {
  a = await peers.start()
  b = await peers.start()
  const tagged = await make_tagged_copy({ dir: scratch_dir(), covers: ['red'] })
  const finished = wait_for_event(a, ({ type }) => type === 'import:finished', 30_000)
  await a.import_files({ paths: [tagged] })
  await finished
  const { items } = await a.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' })
  if (items[0] === undefined) throw new Error('no track')
  track = items[0]
})

afterAll(async () => {
  for (const server of servers.splice(0)) await stop_api_server(server)
  await peers.stop_all()
})

describe('images', () => {
  test('an ingested track\'s artwork is served as image/png, and HEAD finds it', async () => {
    const image_url = await serve(a)
    const [artwork] = track.artwork ?? []
    if (artwork === undefined) throw new Error('no artwork')
    const response = await fetch(image_url(artwork))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect([...new Uint8Array(await response.arrayBuffer()).subarray(0, 8)]).toEqual(PNG_SIGNATURE)
    expect((await fetch(image_url(artwork), { method: 'HEAD' })).status).toBe(200)
  })

  test('the audio blob and a blob over the cap are 404', async () => {
    const image_url = await serve(a)
    const oversized = new Uint8Array(IMAGE_MAX_BYTES + 1)
    oversized.set(PNG_SIGNATURE)
    const oversized_cid = await a.content_store.import_blob(oversized)
    for (const cid of [track.audio_cid, oversized_cid]) {
      expect((await fetch(image_url(cid))).status).toBe(404)
      expect((await fetch(image_url(cid), { method: 'HEAD' })).status).toBe(404)
    }
  })

  test('a peer fetches artwork it does not hold and keeps none of its blocks', async () => {
    const image_url = await serve(b)
    const [artwork] = track.artwork ?? []
    if (artwork === undefined) throw new Error('no artwork')
    expect((await fetch(image_url(artwork), { method: 'HEAD' })).status).toBe(404)
    const response = await fetch(image_url(artwork))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(await b.content_store.has(artwork)).toBe(false)
    expect((await fetch(image_url(artwork), { method: 'HEAD' })).status).toBe(404)
  })
})
