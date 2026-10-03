// HTTP API boundary (spec/7-http-api.yaml). Each restates a protocol rule at
// the API surface, over HTTP against an in-memory peer with response
// validation on; owned by the record-node-api-server task.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { create_fake_resolver, OWN_ADDRESS } from '#test/api/fake-peer.ts'
import { library_path, post_json, start_test_server, type TestServer } from '#test/api/server.ts'
import { audio_pipeline_vector } from './vectors.ts'

const STREAM_URL = 'https://rr1.example-cdn.test/videoplayback?expire=1&sig=abc'
const WATCH_URL = 'https://www.youtube.com/watch?v=abc123'
const SHORT_URL = 'https://youtu.be/abc123'
const NO_ID_URL = 'https://example.test/no-id'
const source = { extractor: 'youtube', id: 'abc123', fulltitle: 'Sine Sweep', duration: 5, webpage_url: WATCH_URL }

let api: TestServer

beforeAll(async () => {
  api = await start_test_server({
    resolve: create_fake_resolver({
      [WATCH_URL]: [{ ...source, url: STREAM_URL, format_id: '251' }],
      [SHORT_URL]: [{ ...source, url: `${STREAM_URL}&other=1` }],
      [NO_ID_URL]: [{ extractor: 'generic', url: STREAM_URL }]
    })
  })
})
afterAll(async () => { await api.stop() })

const resolve = async (url: string) => await fetch(api.url(`/resolve?url=${encodeURIComponent(url)}`))

describe('http-api', () => {
  test('§7 POST /libraries/{address}/about [MUST] rejects an avatar that is not a CID (§2.6)', async () => {
    const about_url = api.url(`${library_path(OWN_ADDRESS)}/about`)
    for (const avatar of ['https://example.com/me.png', 'ipfs://not-a-cid', '']) {
      const response = await post_json(about_url, { avatar })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: [{ field: 'avatar' }] } })
    }
    expect(api.peer.calls.some(({ method }) => method === 'set_about')).toBe(false)

    // A CID is accepted, and null clears the avatar.
    for (const avatar of [audio_pipeline_vector.audio_cid, null]) {
      const response = await post_json(about_url, { avatar })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ library_address: OWN_ADDRESS, avatar })
    }
  })

  test('§7 ResolverEntry [MUST] (extractor, id) uniquely identifies a source pointer (§2.4.2)', async () => {
    // Two spellings of one source resolve to one pointer: the same
    // (extractor, id), whatever streaming URL each resolution carried.
    const [watch, short] = await Promise.all([resolve(WATCH_URL), resolve(SHORT_URL)])
    expect(watch.status).toBe(200)
    const entry = await watch.json() as { extractor: string, id: string }
    expect({ extractor: entry.extractor, id: entry.id }).toEqual({ extractor: 'youtube', id: 'abc123' })
    expect(await short.json()).toEqual(entry)

    // A record with no id cannot name a source pointer, so it is never served as one.
    const unidentified = await resolve(NO_ID_URL)
    expect(unidentified.status).toBe(500)
    expect(await unidentified.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
  })

  test('§7 ResolverEntry [MUST] a streaming url is never persisted (§2.4.2)', async () => {
    const response = await resolve(WATCH_URL)
    const text = await response.text()
    expect(text).not.toContain(STREAM_URL)
    // Only the enumerated ResolverEntry fields cross the boundary.
    expect(JSON.parse(text)).toEqual({ extractor: 'youtube', id: 'abc123', fulltitle: 'Sine Sweep', webpage_url: WATCH_URL, duration: 5 })
  })
})
