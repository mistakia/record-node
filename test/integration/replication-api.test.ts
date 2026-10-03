// Replication through the HTTP and WebSocket API, with response validation
// against 7-http-api.yaml on: Library.replication_status and the
// library:replicate-progress event read the replicator's counters, and
// connect and disconnect drive the real replicator.

import { afterEach, describe, expect, test } from 'bun:test'
import { WebSocket } from 'ws'

import { create_api_server, stop_api_server, type ApiServer } from '#api/index.ts'
import type { Library, PeerEvent, PeerInfo, Settings } from '#types/peer.ts'
import { library_path, post_json } from '#test/api/server.ts'
import { create_fake_resolver } from '#test/api/fake-peer.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
const servers: ApiServer[] = []
const sockets: WebSocket[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  for (const server of servers.splice(0)) await stop_api_server(server)
  await peers.stop_all()
})

describe('replication API', () => {
  test('replication status, progress events, peers, and connect/disconnect over HTTP', async () => {
    const a = await peers.start()
    const b = await peers.start()
    const address = a.identity().own_address
    for (const fingerprint of ['AQADapione', 'AQADapitwo']) await append_track({ peer: a, fingerprint })
    const server = await create_api_server({ peer: b, resolve: create_fake_resolver({}), port: 0, log: false, validate_responses: true })
    servers.push(server)
    const url = (path: string) => `http://127.0.0.1:${server.port}/api${path}`
    const events: PeerEvent[] = []
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws`)
    sockets.push(socket)
    socket.on('message', (data) => { events.push(JSON.parse(String(data)) as PeerEvent) })
    await new Promise((resolve, reject) => { socket.once('open', resolve).once('error', reject) })

    expect((await post_json(url('/libraries'), { library_address: address })).status).toBe(200)
    const replicator = () => b.context.replication?.get(address)
    await wait_until(() => replicator()?.status().progress === 2 && replicator()?.status().total === 2)
    await b.context.replication?.settled(address)

    const get_library = async () => {
      const response = await fetch(url(library_path(address)))
      expect(response.status).toBe(200)
      return await response.json() as Library
    }
    const library = await get_library()
    expect(library.replication_status).toEqual(replicator()?.status() as never)
    expect(library.replication_status).toEqual({ progress: 2, total: 2 })
    expect(library.is_replicating).toBe(false)
    expect(library.peer_ids).toEqual([(await a.get_settings()).peer_id])
    await wait_until(() => events.some(({ type, payload }) => type === 'library:replicate-progress' && payload.library_address === address && payload.progress === 2))
    const progress = events.filter(({ type, payload }) => type === 'library:replicate-progress' && payload.library_address === address)
    expect(progress.at(-1)?.payload).toEqual({ library_address: address, progress: 2, total: 2 })
    expect(events.some(({ type, payload }) => type === 'library:replicated' && payload.library_address === address)).toBe(true)

    const peers_listed = await (await fetch(url('/peers'))).json() as PeerInfo[]
    expect(peers_listed.map(({ peer_id }) => peer_id)).toContain((await a.get_settings()).peer_id)
    const settings = await (await fetch(url('/settings'))).json() as Settings
    expect(settings.peer_id).toBe((await b.get_settings()).peer_id)

    expect((await fetch(url(`${library_path(address)}/disconnect`), { method: 'POST' })).status).toBe(202)
    expect(replicator()?.state()).toBe('paused')
    expect((await get_library()).replication_status).toEqual({ progress: 2, total: 2 })
    expect((await fetch(url(`${library_path(address)}/connect`), { method: 'POST' })).status).toBe(202)
    expect(replicator()?.state()).toBe('running')
    await wait_until(() => events.some(({ type }) => type === 'library:connected'))
  })
})
