// GET and HEAD /images/{cid}: image/* only, sniffed type, immutable caching.
// POST /images: stores and pins an image upload under the same limits.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { create_image_source, IMAGE_MAX_BYTES } from '#peer/images.ts'
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

const upload = async (bytes: Uint8Array, field = 'file'): Promise<Response> => {
  const form = new FormData()
  form.append(field, new Blob([bytes]), 'upload.bin')
  return await fetch(api.url('/images'), { method: 'POST', body: form })
}

const error_of = async (response: Response) => (await response.json() as { error: { code: string } }).error.code

const put_image_calls = () => api.peer.calls.filter(({ method }) => method === 'put_image').length

describe('api: image upload', () => {
  test('201 answers the CID and sniffed type, and GET then serves the image', async () => {
    const response = await upload(PNG)
    expect(response.status).toBe(201)
    const { cid, mime } = await response.json() as { cid: string, mime: string }
    expect(mime).toBe('image/png')
    const served = await fetch(api.url(`/images/${cid}`))
    expect(served.status).toBe(200)
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG)
  })

  test('400 for a file that is not an image, and nothing is stored', async () => {
    const before = put_image_calls()
    const response = await upload(FLAC)
    expect(response.status).toBe(400)
    expect(await error_of(response)).toBe('VALIDATION_ERROR')
    expect(put_image_calls()).toBe(before)
  })

  test('413 for a file over 16 MiB, even one that sniffs as an image, and nothing is stored', async () => {
    const before = put_image_calls()
    const oversized = new Uint8Array(IMAGE_MAX_BYTES + 1)
    oversized.set(PNG)
    const response = await upload(oversized)
    expect(response.status).toBe(413)
    expect(await error_of(response)).toBe('VALIDATION_ERROR')
    expect(put_image_calls()).toBe(before)
  })

  test('400 without a file part, or with the file under another name', async () => {
    expect((await fetch(api.url('/images'), { method: 'POST', body: new FormData() })).status).toBe(400)
    const misnamed = await upload(PNG, 'files')
    expect(misnamed.status).toBe(400)
    expect(await error_of(misnamed)).toBe('VALIDATION_ERROR')
  })
})

describe('images: store', () => {
  test('imports the bytes as one file, pins them recursively, and reads them back', async () => {
    const content_store = create_memory_content_store()
    const images = create_image_source({ content_store, network: undefined, timeout_ms: 1000 })
    const cid = await images.store(PNG)
    expect(await content_store.is_pinned(cid)).toBe(true)
    expect(await images.read_local(cid)).toEqual(PNG)
    expect(await images.store(PNG)).toBe(cid)
  })
})
