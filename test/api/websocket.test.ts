// The /api/ws bridge: every peer event reaches every client as { type,
// payload }, each payload matching its x-websocket-events schema.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Ajv } from 'ajv'
import WebSocket from 'ws'

import { load_api_spec } from '#api/openapi.ts'
import type { PeerEvent } from '#types/peer.ts'
import { make_track, OWN_ADDRESS, TRACK_ID } from './fake-peer.ts'
import { start_test_server, type TestServer } from './server.ts'

const spec = load_api_spec() as {
  components: unknown
  'x-websocket-events': { events: Record<string, { payload: Record<string, unknown> }> }
}
const ajv = new Ajv({ strict: false, validateFormats: false })

// Every declared payload field is required of the events emitted here.
const payload_matches_spec = ({ type, payload }: PeerEvent): boolean => {
  const declared = spec['x-websocket-events'].events[type]?.payload
  if (declared === undefined) throw new Error(`no x-websocket-events entry for ${type}`)
  const schema = { type: 'object', properties: declared, required: Object.keys(declared), components: spec.components }
  return ajv.validate(schema, payload)
}

const IMPORT_ID = '2b0b7f8e-6f0e-4a8e-9a7c-3c1f1f1f1f1f'
const EVENTS: PeerEvent[] = [
  { type: 'import:starting', payload: { import_id: IMPORT_ID, source: 'file', file_count: 1 } },
  { type: 'import:processed-file', payload: { import_id: IMPORT_ID, file_path: '/tmp/a.flac', track: make_track(), completed: 1, remaining: 0 } },
  { type: 'import:finished', payload: { import_id: IMPORT_ID, track_count: 1, error_count: 0 } },
  { type: 'track:removed', payload: { library_address: OWN_ADDRESS, track_id: TRACK_ID } },
  { type: 'library:replicate-progress', payload: { library_address: OWN_ADDRESS, progress: 3, total: 9 } }
]

const connect = async (url: string, protocols?: string[]): Promise<{ socket: WebSocket, messages: unknown[] }> => {
  const socket = new WebSocket(url, protocols)
  const messages: unknown[] = []
  socket.on('message', (data) => { messages.push(JSON.parse(String(data))) })
  await new Promise((resolve, reject) => { socket.once('open', resolve).once('error', reject) })
  return { socket, messages }
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let tries = 0; !condition(); tries++) {
    if (tries > 200) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

let api: TestServer
const ws_url = (query = '') => `ws://127.0.0.1:${api.server.port}/api/ws${query}`

beforeAll(async () => { api = await start_test_server() })
afterAll(async () => { await api.stop() })

describe('api: websocket', () => {
  test('the events emitted here match their x-websocket-events schemas, and a broken one does not', () => {
    for (const event of EVENTS) expect(payload_matches_spec(event)).toBe(true)
    expect(payload_matches_spec({ type: 'import:finished', payload: { import_id: IMPORT_ID, track_count: '1', error_count: 0 } } as never)).toBe(false)
  })

  test('every client receives every peer event as { type, payload }', async () => {
    const clients = [await connect(ws_url()), await connect(ws_url())]
    for (const event of EVENTS) api.peer.emit(event)
    await until(() => clients.every(({ messages }) => messages.length === EVENTS.length))
    for (const { messages } of clients) expect(messages).toEqual(EVENTS)
    for (const { socket } of clients) socket.close()
    await until(() => api.server.bridge.clients.size === 0)
  })

  test('an upgrade outside /api/ws is refused', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${api.server.port}/api/other`)
    const status = await new Promise((resolve) => { socket.once('unexpected-response', (_req, res) => { resolve(res.statusCode) }).once('error', () => { resolve('error') }) })
    expect(status === 404 || status === 'error').toBe(true)
  })

  test('hosted mode authenticates the upgrade from the bearer. subprotocol, selects record, and ignores a query token', async () => {
    const hosted = await start_test_server({ authenticate: (token) => token === 'good' })
    try {
      const url = (query = '') => `ws://127.0.0.1:${hosted.server.port}/api/ws${query}`
      const refused_status = async (socket: WebSocket) => await new Promise((resolve) => {
        socket.once('unexpected-response', (_req, res) => { resolve(res.statusCode) }).once('error', () => { resolve('error') })
      })
      for (const refused of [new WebSocket(url(), ['record', 'bearer.bad']), new WebSocket(url('?token=good'))]) {
        const status = await refused_status(refused)
        expect(status === 401 || status === 'error').toBe(true)
      }
      const { socket } = await connect(url(), ['record', 'bearer.good'])
      // The token is never echoed back: the node selects record.
      expect(socket.protocol).toBe('record')
      socket.close()
    } finally {
      await hosted.stop()
    }
  })

  test('an upgrade from an origin off the allowlist is refused, and one with no origin is not', async () => {
    const locked = await start_test_server({ cors_origins: ['app://record'] })
    try {
      const url = `ws://127.0.0.1:${locked.server.port}/api/ws`
      // Bun's ws client ignores the origin option, so the header is set directly.
      const refused = new WebSocket(url, { headers: { origin: 'https://evil.example' } })
      const status = await new Promise((resolve) => { refused.once('unexpected-response', (_req, res) => { resolve(res.statusCode) }).once('error', () => { resolve('error') }) })
      expect(status === 403 || status === 'error').toBe(true)
      const { socket } = await connect(url)
      socket.close()
    } finally {
      await locked.stop()
    }
  })

  test('with no allowlist configured, an upgrade from any browser origin is refused', async () => {
    const own = await start_test_server()
    try {
      const refused = new WebSocket(`ws://127.0.0.1:${own.server.port}/api/ws`, { headers: { origin: 'http://localhost:8080' } })
      const status = await new Promise((resolve) => { refused.once('unexpected-response', (_req, res) => { resolve(res.statusCode) }).once('error', () => { resolve('error') }) })
      expect(status === 403 || status === 'error').toBe(true)
    } finally {
      await own.stop()
    }
  })

  test('stopping the server closes clients with 1001 and unsubscribes from the peer', async () => {
    const own = await start_test_server()
    const { socket } = await connect(`ws://127.0.0.1:${own.server.port}/api/ws`)
    const closed = new Promise((resolve) => { socket.once('close', (code) => { resolve(code) }) })
    expect(own.peer.listener_count()).toBe(1)
    await own.stop()
    expect(await closed).toBe(1001)
    expect(own.peer.listener_count()).toBe(0)
  })
})
