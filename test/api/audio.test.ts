// GET and HEAD /audio/{cid}: Range handling, MIME sniffing, local-only reads.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { audio_pipeline_vector } from '#test/conformance/vectors.ts'
import { AUDIO_CID } from './fake-peer.ts'
import { start_test_server, type TestServer } from './server.ts'

const FLAC = new Uint8Array(readFileSync(audio_pipeline_vector.fixture_path))
const MISSING_CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

let api: TestServer

beforeAll(async () => {
  api = await start_test_server()
  api.peer.audio.set(AUDIO_CID, FLAC)
})
afterAll(async () => { await api.stop() })

describe('api: audio', () => {
  test('200 serves the whole blob with its sniffed type and Accept-Ranges', async () => {
    const response = await fetch(api.url(`/audio/${AUDIO_CID}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('audio/flac')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-length')).toBe(String(FLAC.length))
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FLAC)
  })

  test('206 serves the requested byte range', async () => {
    const response = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: 'bytes=4-1027' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 4-1027/${FLAC.length}`)
    expect(response.headers.get('content-length')).toBe('1024')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FLAC.subarray(4, 1028))
  })

  test('206 serves an open-ended and a suffix range', async () => {
    const open = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: `bytes=${FLAC.length - 10}-` } })
    expect(open.status).toBe(206)
    expect((await open.arrayBuffer()).byteLength).toBe(10)
    const suffix = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: 'bytes=-16' } })
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(FLAC.subarray(FLAC.length - 16))
  })

  test('416 for an unsatisfiable range; a malformed range is ignored', async () => {
    const beyond = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: `bytes=${FLAC.length + 1}-` } })
    expect(beyond.status).toBe(416)
    expect(beyond.headers.get('content-range')).toBe(`bytes */${FLAC.length}`)
    const malformed = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: 'pages=1-2' } })
    expect(malformed.status).toBe(200)
  })

  test('404 for a CID not in the local store, and for a string that is not a CID', async () => {
    for (const cid of [MISSING_CID, 'not-a-cid']) {
      const response = await fetch(api.url(`/audio/${cid}`))
      expect(response.status).toBe(404)
      expect((await response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    }
  })

  test('HEAD answers local availability without a body', async () => {
    expect((await fetch(api.url(`/audio/${AUDIO_CID}`), { method: 'HEAD' })).status).toBe(200)
    expect((await fetch(api.url(`/audio/${MISSING_CID}`), { method: 'HEAD' })).status).toBe(404)
  })
})
