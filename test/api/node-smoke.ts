// Node smoke run of the API server: record-app runs the node as a Node child
// process (spec §8.3.1), so the API must run there, not only under Bun. Exercises the
// validated JSON path, a multipart upload through multer, a Range read, and a
// WebSocket event. Run with `node test/api/node-smoke.ts` (Node 22.18+).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import WebSocket from 'ws'

import { audio_pipeline_vector } from '#test/conformance/vectors.ts'
import { AUDIO_CID } from './fake-peer.ts'
import { start_test_server } from './server.ts'

const flac = readFileSync(audio_pipeline_vector.fixture_path)
const api = await start_test_server()
api.peer.audio.set(AUDIO_CID, new Uint8Array(flac))

try {
  const settings = await fetch(api.url('/settings'))
  assert.equal(settings.status, 200)

  const form = new FormData()
  form.append('files', new Blob([flac]), 'a.flac')
  const upload = await fetch(api.url('/import/file'), { method: 'POST', body: form })
  assert.equal(upload.status, 202)
  const [path] = (api.peer.calls.find(({ method }) => method === 'import_files')?.args[0] as { paths: string[] }).paths
  assert.deepEqual(readFileSync(path as string), flac)

  const range = await fetch(api.url(`/audio/${AUDIO_CID}`), { headers: { range: 'bytes=0-3' } })
  assert.equal(range.status, 206)
  assert.equal(range.headers.get('content-type'), 'audio/flac')
  assert.equal(Buffer.from(await range.arrayBuffer()).toString(), 'fLaC')

  const socket = new WebSocket(`ws://127.0.0.1:${api.server.port}/api/ws`)
  await new Promise((resolve, reject) => { socket.once('open', resolve).once('error', reject) })
  const received = new Promise((resolve) => { socket.once('message', (data) => { resolve(JSON.parse(String(data))) }) })
  const event = { type: 'import:finished', payload: { import_id: '2b0b7f8e-6f0e-4a8e-9a7c-3c1f1f1f1f1f', track_count: 1, error_count: 0 } } as const
  api.peer.emit(event)
  assert.deepEqual(await received, event)
  socket.close()

  // A read whose client hung up while the node was busy is not run: the
  // request and the close both wait in the kernel while the loop is blocked.
  const list_calls = () => api.peer.calls.filter(({ method }) => method === 'list_tracks').length
  const before = list_calls()
  const clients = await Promise.all([0, 1, 2].map(async () => {
    const client = connect(api.server.port, '127.0.0.1')
    client.on('error', () => {})
    await new Promise((resolve) => client.once('connect', resolve))
    return client
  }))
  for (const client of clients) client.end('GET /api/tracks HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n')
  const blocked_until = Date.now() + 100
  while (Date.now() < blocked_until);
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(list_calls(), before)
  assert.equal((await fetch(api.url('/tracks'))).status, 200)
  assert.equal(list_calls(), before + 1)

  console.log(`node ${process.version}: API smoke passed`)
} finally {
  await api.stop()
}
