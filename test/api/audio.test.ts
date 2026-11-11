// GET and HEAD /audio/{cid}: Range handling, MIME sniffing, local-only reads.

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import type { UnixFsFile } from '#fabric/unixfs.ts'
import { audio_pipeline_vector } from '#test/conformance/vectors.ts'
import { ProtocolError } from '#types/errors.ts'
import { AUDIO_CID, bytes_as_unixfs_file } from './fake-peer.ts'
import { start_test_server, type TestServer } from './server.ts'

const FLAC = new Uint8Array(readFileSync(audio_pipeline_vector.fixture_path))
// The route sniffs at most this many bytes before the headers.
const MIME_SNIFF_LIMIT = 4100
const MISSING_CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'

let api: TestServer

beforeAll(async () => {
  api = await start_test_server()
  api.peer.audio.set(AUDIO_CID, FLAC)
})
afterAll(async () => { await api.stop() })

// Serves file in place of the fake peer's audio for one test, with
// console.error (the API's error log) spied on.
const with_audio_file = async (file: UnixFsFile, run: (logged: () => number) => Promise<void>) => {
  const open_audio = api.peer.open_audio
  const log = spyOn(console, 'error').mockImplementation(() => {})
  api.peer.open_audio = async () => file
  try {
    await run(() => log.mock.calls.length)
  } finally {
    api.peer.open_audio = open_audio
    log.mockRestore()
  }
}

const sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms))

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

  test('404 when the first block cannot be read before the headers go out', async () => {
    await with_audio_file({
      file_size: FLAC.length,
      read_range: () => { throw new ProtocolError('content_unavailable', 'block not stored') }
    }, async () => {
      const response = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: 'bytes=100-199' } })
      expect(response.status).toBe(404)
      expect((await response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    })
  })

  test('404 when the first block a range covers cannot be read, though the sniff could', async () => {
    const whole = bytes_as_unixfs_file(FLAC)
    await with_audio_file({
      file_size: FLAC.length,
      read_range: async function * ({ start_offset, end_offset }) {
        if (start_offset > 0) throw new ProtocolError('content_unavailable', 'block not stored')
        yield * whole.read_range({ start_offset, end_offset })
      }
    }, async () => {
      const response = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: 'bytes=5000-5099' } })
      expect(response.status).toBe(404)
      expect((await response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    })
  })

  test('a block lost mid-body cuts the transfer short and is logged', async () => {
    const whole = bytes_as_unixfs_file(FLAC)
    await with_audio_file({
      file_size: FLAC.length,
      read_range: async function * ({ start_offset, end_offset }) {
        if (end_offset - start_offset < MIME_SNIFF_LIMIT) {
          yield * whole.read_range({ start_offset, end_offset })
          return
        }
        yield FLAC.subarray(start_offset, start_offset + 1000)
        throw new ProtocolError('content_unavailable', 'block not stored')
      }
    }, async (logged) => {
      const response = await fetch(api.url(`/audio/${AUDIO_CID}`))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-length')).toBe(String(FLAC.length))
      let failed = false
      try {
        await response.arrayBuffer()
      } catch {
        failed = true
      }
      expect(failed).toBe(true)
      expect(logged()).toBe(1)
    })
  })

  test('a client hanging up mid-body is not logged', async () => {
    let chunks_sent = 0
    await with_audio_file({
      file_size: 1000 * 1000,
      read_range: async function * ({ start_offset, end_offset }) {
        for (let offset = start_offset; offset <= end_offset; offset += 1000) {
          if (offset > 0) await sleep(5)
          chunks_sent += 1
          yield new Uint8Array(Math.min(1000, end_offset - offset + 1))
        }
      }
    }, async (logged) => {
      const abort = new AbortController()
      const response = await fetch(api.url(`/audio/${AUDIO_CID}`), { signal: abort.signal })
      expect(response.status).toBe(200)
      await response.body!.getReader().read()
      abort.abort()
      await sleep(100)
      const sent_at_abort = chunks_sent
      await sleep(100)
      expect(chunks_sent - sent_at_abort).toBeLessThanOrEqual(1)
      expect(chunks_sent).toBeLessThan(1000)
      expect(logged()).toBe(0)
    })
  })

  test('200 with no body for an empty blob', async () => {
    await with_audio_file(bytes_as_unixfs_file(new Uint8Array(0)), async () => {
      const response = await fetch(api.url(`/audio/${AUDIO_CID}`))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-length')).toBe('0')
      expect((await response.arrayBuffer()).byteLength).toBe(0)
    })
  })
})
