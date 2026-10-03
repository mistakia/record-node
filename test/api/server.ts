// Start the API on an ephemeral port with response validation on.

import { create_api_server, stop_api_server, type ApiServer, type ApiServerOptions } from '#api/index.ts'
import type { Resolver } from '#types/peer.ts'
import { create_fake_peer, create_fake_resolver, type FakePeer } from './fake-peer.ts'

export interface TestServer {
  peer: FakePeer
  server: ApiServer
  url: (path: string) => string
  stop: () => Promise<void>
}

export const start_test_server = async ({ resolve = create_fake_resolver({}), ...options }: {
  resolve?: Resolver
} & Partial<Omit<ApiServerOptions, 'peer' | 'resolve' | 'port'>> = {}): Promise<TestServer> => {
  const peer = create_fake_peer()
  const server = await create_api_server({ peer, resolve, port: 0, log: false, validate_responses: true, ...options })
  return {
    peer,
    server,
    url: (path) => `http://127.0.0.1:${server.port}/api${path}`,
    stop: async () => { await stop_api_server(server) }
  }
}

export const post_json = async (url: string, body: unknown): Promise<Response> =>
  await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const library_path = (address: string): string => `/libraries/${encodeURIComponent(address)}`
