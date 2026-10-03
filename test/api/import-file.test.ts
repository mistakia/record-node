// POST /import/file: the multipart upload path through multer, on Bun and
// on Node alike (the multer-on-Bun smoke test).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'

import { audio_pipeline_vector } from '#test/conformance/vectors.ts'
import { start_test_server, type TestServer } from './server.ts'

const FLAC = readFileSync(audio_pipeline_vector.fixture_path)

let api: TestServer

beforeAll(async () => { api = await start_test_server() })
afterAll(async () => { await api.stop() })

const upload = async (files: Array<{ name: string, bytes: Uint8Array }>): Promise<Response> => {
  const form = new FormData()
  for (const { name, bytes } of files) form.append('files', new Blob([bytes]), name)
  return await fetch(api.url('/import/file'), { method: 'POST', body: form })
}

describe('api: import/file', () => {
  test('buffers every file to disk intact and hands the paths to ingest', async () => {
    const response = await upload([{ name: 'a.flac', bytes: FLAC }, { name: 'b.mp3', bytes: FLAC.subarray(0, 100) }])
    expect(response.status).toBe(202)
    const ack = await response.json() as { import_id: string, file_count: number }
    expect(ack.file_count).toBe(2)
    const { paths } = api.peer.calls.findLast(({ method }) => method === 'import_files')?.args[0] as { paths: string[] }
    expect(paths.map((path) => extname(path))).toEqual(['.flac', '.mp3'])
    expect(new Uint8Array(readFileSync(paths[0] as string))).toEqual(new Uint8Array(FLAC))
    expect(readFileSync(paths[1] as string).length).toBe(100)
  })

  test('removes the buffered files when ingest refuses them', async () => {
    const original = api.peer.import_files
    let refused: string[] = []
    api.peer.import_files = async ({ paths }) => {
      refused = paths
      throw new Error('disk full')
    }
    try {
      const response = await upload([{ name: 'a.flac', bytes: FLAC }])
      expect(response.status).toBe(500)
      expect(refused.length).toBe(1)
      expect(existsSync(refused[0] as string)).toBe(false)
    } finally {
      api.peer.import_files = original
    }
  })

  test('a request without files is a 400', async () => {
    const response = await fetch(api.url('/import/file'), { method: 'POST', body: new FormData() })
    expect(response.status).toBe(400)
  })
})
