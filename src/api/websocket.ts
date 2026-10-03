// The WebSocket bridge at /api/ws: relays every peer event to every client
// as { type, payload } JSON (x-websocket-events in 7-http-api.yaml). It holds
// no state beyond the open clients; a reconnecting client reads current
// state over REST. The client offers the subprotocols record and
// bearer.<token>; the upgrade authenticates from the second and selects the
// first, so the token is never echoed back. An offer without record is
// refused, since the node would otherwise select no subprotocol; a client
// offering none, as a loopback client without a token may, is accepted.

import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'

import type { ApiPeer } from '#types/peer.ts'
import { origin_allowed, type Authenticate } from './middleware.ts'

export const WS_PATH = '/api/ws'
export const WS_SUBPROTOCOL = 'record'
const TOKEN_SUBPROTOCOL_PREFIX = 'bearer.'

const offered_subprotocols = (req: IncomingMessage): string[] =>
  (req.headers['sec-websocket-protocol'] ?? '').split(',').map((protocol) => protocol.trim()).filter((protocol) => protocol !== '')

export const subprotocol_token = (req: IncomingMessage): string | undefined =>
  offered_subprotocols(req).find((protocol) => protocol.startsWith(TOKEN_SUBPROTOCOL_PREFIX))?.slice(TOKEN_SUBPROTOCOL_PREFIX.length)

export interface EventBridge {
  clients: Set<WebSocket>
  close: () => Promise<void>
}

const refuse_upgrade = (socket: Duplex, status: string): void => {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
}

export const attach_event_bridge = ({ http_server, peer, authenticate, cors_origins }: {
  http_server: Server
  peer: ApiPeer
  authenticate: Authenticate | undefined
  cors_origins: readonly string[]
}): EventBridge => {
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false
  })
  const clients = new Set<WebSocket>()

  const on_upgrade = async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== WS_PATH) {
      refuse_upgrade(socket, '404 Not Found')
      return
    }
    // A WebSocket handshake carries no CORS check, so the origin rule is applied here.
    if (!origin_allowed(cors_origins, req.headers.origin)) {
      refuse_upgrade(socket, '403 Forbidden')
      return
    }
    const offered = offered_subprotocols(req)
    if (offered.length > 0 && !offered.includes(WS_SUBPROTOCOL)) {
      refuse_upgrade(socket, '400 Bad Request')
      return
    }
    if (authenticate !== undefined && !(await authenticate(subprotocol_token(req)))) {
      refuse_upgrade(socket, '401 Unauthorized')
      return
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      clients.add(client)
      client.on('close', () => { clients.delete(client) })
      client.on('error', () => { clients.delete(client) })
    })
  }
  const upgrade_listener = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    on_upgrade(req, socket, head).catch(() => { socket.destroy() })
  }
  http_server.on('upgrade', upgrade_listener)

  const unsubscribe = peer.subscribe((event) => {
    const message = JSON.stringify(event)
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(message)
    }
  })

  return {
    clients,
    close: async () => {
      unsubscribe()
      http_server.off('upgrade', upgrade_listener)
      for (const client of clients) client.close(1001, 'server shutting down')
      await new Promise<void>((resolve) => { wss.close(() => { resolve() }) })
    }
  }
}
