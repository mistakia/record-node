// The API server: an Express app serving 7-http-api.yaml under /api, and the
// WebSocket bridge on the same HTTP server. Signal handling belongs to the
// process entry point, which calls stop_api_server.

import { mkdir } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express, { Router } from 'express'
import morgan from 'morgan'

import type { ApiPeer, Resolver } from '#types/peer.ts'
import { authenticate_requests, cors, handle_errors, no_cache, type Authenticate } from './middleware.ts'
import { create_docs_router, create_validator, load_api_spec, parse_uploads } from './openapi.ts'
import { attach_event_bridge, type EventBridge } from './websocket.ts'
import { audio_router } from './routes/audio.ts'
import { identity_router } from './routes/identity.ts'
import { import_router } from './routes/import.ts'
import { libraries_router } from './routes/libraries.ts'
import { listens_router } from './routes/listens.ts'
import { peers_router } from './routes/peers.ts'
import { resolve_router } from './routes/resolve.ts'
import { settings_router } from './routes/settings.ts'
import { tags_router } from './routes/tags.ts'
import { tracks_router } from './routes/tracks.ts'

const DRAIN_TIMEOUT_MS = 5000

// Uploads wait here for ingest, which removes each file when done with it, so
// the directory outlives any one server.
const UPLOAD_DIR = join(tmpdir(), 'record-node-uploads')

export interface ApiServerOptions {
  peer: ApiPeer
  resolve: Resolver
  port: number
  // Loopback by default: the local-first node is not a network service.
  host?: string
  // Hosted mode: the allowed CORS origins, and a bearer-token verifier.
  cors_origins?: readonly string[]
  authenticate?: Authenticate
  // Request logging (default on).
  log?: boolean
  // Validate responses against the spec too (the tests turn this on).
  validate_responses?: boolean
}

export interface ApiServer {
  http_server: Server
  port: number
  bridge: EventBridge
}

export const create_api_server = async ({
  peer,
  resolve: resolver,
  port,
  host = '127.0.0.1',
  cors_origins,
  authenticate,
  log = true,
  validate_responses = false
}: ApiServerOptions): Promise<ApiServer> => {
  const spec = load_api_spec()
  await mkdir(UPLOAD_DIR, { recursive: true })

  const api = Router()
  api.use('/docs', create_docs_router(spec))
  api.use(authenticate_requests(authenticate))
  api.use(express.json())
  api.post('/import/file', parse_uploads(UPLOAD_DIR))
  api.use(create_validator({ spec, validate_responses }))
  api.use('/tracks', tracks_router(peer))
  api.use('/tags', tags_router(peer))
  api.use('/libraries', libraries_router(peer))
  api.use('/listens', listens_router(peer))
  api.use('/peers', peers_router(peer))
  api.use('/settings', settings_router(peer))
  api.use('/identity', identity_router(peer))
  api.use('/import', import_router(peer))
  api.use('/audio', audio_router(peer))
  api.use('/resolve', resolve_router(resolver))

  const app = express()
  app.disable('x-powered-by')
  if (log) app.use(morgan('dev'))
  app.use(cors(cors_origins))
  app.use('/api', no_cache, api)
  app.use(handle_errors((error) => { console.error(error) }))

  const http_server = createServer(app)
  const bridge = attach_event_bridge({ http_server, peer, authenticate })
  try {
    await new Promise<void>((resolve, reject) => {
      http_server.once('error', reject)
      http_server.listen(port, host, () => { resolve() })
    })
  } catch (error) {
    await bridge.close()
    throw error
  }
  return { http_server, port: (http_server.address() as AddressInfo).port, bridge }
}

// Close the WebSocket clients, stop accepting connections, give in-flight
// requests DRAIN_TIMEOUT_MS, then cut what remains.
export const stop_api_server = async ({ http_server, bridge }: ApiServer): Promise<void> => {
  await bridge.close()
  const closed = new Promise<void>((resolve) => { http_server.close(() => { resolve() }) })
  http_server.closeIdleConnections()
  const timer = setTimeout(() => { http_server.closeAllConnections() }, DRAIN_TIMEOUT_MS)
  await closed
  clearTimeout(timer)
}
