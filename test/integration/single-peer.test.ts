// The single-peer stage gate: one peer creates its library, ingests the F7
// file, queries it, and serves 7-http-api.yaml with response validation on,
// so every response below has passed the spec's schema. Events arrive over
// /api/ws and are checked against x-websocket-events.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Ajv } from 'ajv'
import WebSocket from 'ws'

import { create_api_server, stop_api_server, type ApiServer } from '#api/index.ts'
import { load_api_spec } from '#api/openapi.ts'
import { create_peer, start_peer, stop_peer, type Peer } from '#peer/peer.ts'
import { as_api_resolver } from '#peer/resolver.ts'
import { audio_pipeline_vector as f7 } from '#test/conformance/vectors.ts'
import { preflight_bypassed } from '#test/helpers/ingest.ts'
import { fixture_download, fixture_resolver, YOUTUBE_FIXTURE, YOUTUBE_STREAM_URL, YOUTUBE_URL } from '#test/helpers/resolver.ts'
import type { PeerEvent, Track, TrackList } from '#types/peer.ts'

const spec = load_api_spec() as { components: unknown, 'x-websocket-events': { events: Record<string, { payload: Record<string, unknown> }> } }
const ajv = new Ajv({ strict: false, validateFormats: false })
const event_matches_spec = ({ type, payload }: PeerEvent): boolean => {
  const declared = spec['x-websocket-events'].events[type]?.payload
  if (declared === undefined) return false
  return ajv.validate({ type: 'object', properties: declared, components: spec.components }, payload)
}

let peer: Peer
let server: ApiServer
let socket: WebSocket
const events: PeerEvent[] = []
const url = (path: string) => `http://127.0.0.1:${server.port}/api${path}`
const get_json = async <T>(path: string): Promise<T> => {
  const response = await fetch(url(path))
  expect(response.status).toBe(200)
  return await response.json() as T
}
const post_json = async (path: string, body: unknown) =>
  await fetch(url(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const finished = async (import_id: string): Promise<PeerEvent[]> => {
  for (let attempt = 0; attempt < 600; attempt++) {
    const batch = events.filter(({ payload }) => (payload as { import_id?: string }).import_id === import_id)
    if (batch.some(({ type }) => type === 'import:finished')) return batch
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`import ${import_id} did not finish`)
}

beforeAll(async () => {
  peer = await create_peer({
    config: { allow_toolchain_mismatch: preflight_bypassed },
    resolve: fixture_resolver(YOUTUBE_FIXTURE),
    download: fixture_download()
  })
  await start_peer(peer)
  server = await create_api_server({ peer, resolve: as_api_resolver(peer.context.resolve), port: 0, log: false, validate_responses: true })
  socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws`)
  socket.on('message', (data) => { events.push(JSON.parse(String(data)) as PeerEvent) })
  await new Promise((resolve, reject) => { socket.once('open', resolve).once('error', reject) })
})

afterAll(async () => {
  socket.close()
  await stop_api_server(server)
  await stop_peer(peer)
})

describe('single peer', () => {
  test('creates its own library on start', async () => {
    const libraries = await get_json<Array<{ address: string, is_own: boolean, track_count: number }>>('/libraries')
    expect(libraries).toEqual([expect.objectContaining({ address: peer.identity().own_address, is_own: true, track_count: 0 })])
  })

  test('ingests the F7 file uploaded to /import/file and serves it back', async () => {
    const form = new FormData()
    form.append('files', new Blob([readFileSync(f7.fixture_path)]), 'sine-sweep-5s.flac')
    const response = await fetch(url('/import/file'), { method: 'POST', body: form })
    expect(response.status).toBe(202)
    const { import_id } = await response.json() as { import_id: string }
    const batch = await finished(import_id)
    expect(batch.map(({ type }) => type)).toEqual(['import:starting', 'import:processed-file', 'import:finished'])
    for (const event of batch) expect(event_matches_spec(event)).toBe(true)

    const { items, total } = await get_json<TrackList>('/tracks')
    expect(total).toBe(1)
    expect(items[0]).toMatchObject({ id: f7.track_id, audio_cid: f7.audio_cid, have_track: true, duration_seconds: 5 })
    const audio = await fetch(url(`/audio/${f7.audio_cid}`))
    expect(audio.status).toBe(200)
    expect((await audio.arrayBuffer()).byteLength).toBe((items[0] as Track).audio_size_bytes)
    expect(events.some(({ type, payload }) => type === 'track:added' && (payload as { track: Track }).track.id === f7.track_id)).toBe(true)
  })

  test('queries the track by text, tags it, and records a listen', async () => {
    expect((await get_json<TrackList>('/tracks?query=nothing-matches')).total).toBe(0)
    const tagged = await post_json('/tags', { track_id: f7.track_id, tag: 'sweep' })
    expect(tagged.status).toBe(200)
    expect((await get_json<TrackList>('/tracks?tags=sweep')).items.map(({ id }) => id)).toEqual([f7.track_id])
    expect(await get_json<unknown>('/tags')).toEqual([{ tag: 'sweep', count: 1 }])
    const listen = await post_json('/listens', { track_id: f7.track_id, library_address: peer.identity().own_address })
    expect(await listen.json()).toMatchObject({ track_id: f7.track_id, count: 1 })
    expect((await get_json<TrackList>('/listens')).items).toEqual([expect.objectContaining({ id: f7.track_id, listen_count: 1 })])
  })

  test('previews and imports a URL through the resolver, persisting no stream url', async () => {
    const preview = await get_json<Record<string, unknown>>(`/resolve?url=${encodeURIComponent(YOUTUBE_URL)}`)
    expect(preview).toMatchObject({ extractor: 'youtube', id: 'iODdvJGpfIA', duration: 262 })
    expect(preview).not.toHaveProperty('url')
    const response = await post_json('/import/url', { url: YOUTUBE_URL })
    expect(response.status).toBe(202)
    const { import_id } = await response.json() as { import_id: string }
    const batch = await finished(import_id)
    for (const event of batch) expect(event_matches_spec(event)).toBe(true)
    const processed = batch.find(({ type }) => type === 'import:processed-file')?.payload as { file_path: string, track: Track }
    expect(processed.file_path).toBe(YOUTUBE_URL)
    expect(processed.track.resolvers).toEqual([expect.objectContaining({ extractor: 'youtube', id: 'iODdvJGpfIA', duration: 262 })])
    expect(JSON.stringify(await get_json<unknown>('/tracks'))).not.toContain(YOUTUBE_STREAM_URL)
  })

  test('a URL the resolver cannot take is a 400', async () => {
    const response = await post_json('/import/url', { url: 'ftp://example.invalid/a.mp3' })
    expect(response.status).toBe(400)
  })

  test('reports settings and exports an identity that reimports to the same library', async () => {
    const settings = await get_json<{ peer_id: string }>('/settings')
    expect(settings.peer_id).toMatch(/^16Uiu2/)
    const { private_key } = await get_json<{ private_key: string }>('/identity/export')
    const imported = await post_json('/identity/import', { private_key })
    expect(await imported.json()).toMatchObject({ own_library_address: peer.identity().own_address })
    expect((await get_json<TrackList>('/tracks')).total).toBe(2)
  })
})
