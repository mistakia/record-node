// GET and HEAD /images/{cid}: image/* only, sniffed type, immutable caching.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { audio_pipeline_vector } from '#test/conformance/vectors.ts'
import { AUDIO_CID } from './fake-peer.ts'
import { start_test_server, type TestServer } from './server.ts'

// A 1x1 PNG.
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
const PNG_CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
const MISSING_CID = 'bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4'
const FLAC = new Uint8Array(readFileSync(audio_pipeline_vector.fixture_path))

let api: TestServer

beforeAll(async () => {
  api = await start_test_server()
  api.peer.images.set(PNG_CID, PNG)
  api.peer.images.set(AUDIO_CID, FLAC)
})
afterAll(async () => { await api.stop() })

describe('api: images', () => {
  test('200 serves the whole image with its sniffed type and an immutable Cache-Control', async () => {
    const response = await fetch(api.url(`/images/${PNG_CID}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(PNG.length))
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  test('404 for an unknown CID, a string that is not a CID, and a blob that is not an image', async () => {
    for (const cid of [MISSING_CID, 'not-a-cid', AUDIO_CID]) {
      const response = await fetch(api.url(`/images/${cid}`))
      expect(response.status).toBe(404)
      expect((await response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    }
  })

  test('HEAD reads the local store only and answers 200 only for an image, without a body', async () => {
    const found = await fetch(api.url(`/images/${PNG_CID}`), { method: 'HEAD' })
    expect(found.status).toBe(200)
    expect((await found.arrayBuffer()).byteLength).toBe(0)
    for (const cid of [MISSING_CID, AUDIO_CID]) {
      expect((await fetch(api.url(`/images/${cid}`), { method: 'HEAD' })).status).toBe(404)
    }
    expect(api.peer.calls.filter(({ method }) => method === 'get_image').at(-1)?.args).toEqual([AUDIO_CID, { local_only: true }])
  })
})
