// The §5.6 modes on loopback: the own-peers relay's reservation gate, a
// relayed node that advertises and dials only through its relay yet is found
// by peer id and replicates, the DCUtR exchange over a relayed connection,
// and the §5.6.4 agent string.

import { afterEach, describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'

import type { Connection, Stream } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr } from '@multiformats/multiaddr'

import type { NetworkConfig } from '#adapter/libp2p/config.ts'
import { agent_string, type RecordLibp2p } from '#adapter/libp2p/node.ts'
import { compute_track_id } from '#entry/id.ts'
import { create_libp2p_peers, dial_address, libp2p_of, LOOPBACK, seeded_data_dir } from '#test/helpers/libp2p.ts'
import { stop_peer } from '#peer/peer.ts'
import { append_track, wait_for_event, wait_until } from '#test/helpers/network.ts'
import type { Peer } from '#peer/peer.ts'

const peers = create_libp2p_peers()
afterEach(async () => { await peers.stop_all() })

const CIRCUIT = '/p2p-circuit'
const DCUTR = '/libp2p/dcutr'

const addresses_of = async (peer: Peer) => (await peer.get_settings()).addresses ?? []
const relayed_network = (relay_address: string): Partial<NetworkConfig> => ({ ...LOOPBACK, mode: 'relayed', listen: [], relay_address })

describe('network modes', () => {
  test('the identify agent string names the version and mode, not the runtime', async () => {
    expect(agent_string('masked', '1.2.7')).toBe('record-node/1.2 (masked)')
    const a = await peers.start()
    const b = await peers.start({ bootstrap: [await dial_address(a)] })
    const b_id = libp2p_of(b).peerId
    await wait_until(async () => (await libp2p_of(a).peerStore.get(b_id).catch(() => undefined))?.metadata.has('AgentVersion') === true)
    const agent = new TextDecoder().decode((await libp2p_of(a).peerStore.get(b_id)).metadata.get('AgentVersion'))
    expect(agent).toMatch(/^record-node\/\d+\.\d+ \(public\)$/)
    expect((await b.get_settings()).network_mode).toBe('public')
  })

  test('the own-peers relay reserves only for its listed peers', async () => {
    const { peer_id: listed } = await seeded_data_dir()
    const relay = await peers.start({ relay_server: { allowed_peer_ids: [listed] } })
    // A public node with no listener reserves on any relay it meets.
    const outsider = await peers.start({ listen: [], bootstrap: [await dial_address(relay)] })
    await wait_until(async () => (await outsider.list_peers()).length > 0)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect((await addresses_of(outsider)).filter((address) => address.includes(CIRCUIT))).toEqual([])
  })

  test('a relayed node advertises only its circuit, dials only its relay, and is found by peer id', async () => {
    const { data_dir, peer_id: relayed_id } = await seeded_data_dir()
    const relay = await peers.start({ dht: true, relay_server: { allowed_peer_ids: [relayed_id] } })
    const relay_address = await dial_address(relay)
    const relayed = await peers.start({ ...relayed_network(relay_address), dht: true }, { data_dir })
    await append_track({ peer: relayed, fingerprint: 'AQADtEmSaImS' })

    await wait_until(async () => (await addresses_of(relayed)).length > 0, 15_000)
    const advertised = await addresses_of(relayed)
    expect(advertised.every((address) => address.startsWith(`${relay_address}${CIRCUIT}`))).toBe(true)

    // A third peer that knows only the relay.
    const finder = await peers.start({ dht: true, bootstrap: [relay_address] })
    const finder_direct = await dial_address(finder)
    await expect(libp2p_of(relayed).dial(multiaddr(finder_direct))).rejects.toThrow()

    // The relay's routing table takes the relayed node once identify runs.
    let found: Awaited<ReturnType<RecordLibp2p['peerRouting']['findPeer']>> | undefined
    await wait_until(async () => {
      found = await libp2p_of(finder).peerRouting.findPeer(peerIdFromString(relayed_id), { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
      if (found === undefined) await new Promise((resolve) => setTimeout(resolve, 250))
      return found !== undefined
    }, 20_000)
    if (found === undefined) throw new Error('unreachable')
    expect(found.multiaddrs.map(String).every((address) => address.includes(CIRCUIT))).toBe(true)
    await libp2p_of(finder).dial(found.id)

    const library = relayed.identity().own_address
    const replicated = wait_for_event(finder, (event) => event.type === 'track:added' && event.payload.library_address === library, 20_000)
    await finder.link_library({ address: library, alias: null })
    await replicated
    const items = (await finder.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc', library_addresses: [library] })).items
    expect(items.map(({ id }) => id)).toEqual([compute_track_id('AQADtEmSaImS')])
    // Every connection the relayed node holds runs to or through the relay.
    const relay_id = libp2p_of(relay).peerId.toString()
    for (const connection of libp2p_of(relayed).getConnections()) {
      const remote = connection.remoteAddr.toString()
      expect(connection.remotePeer.toString() === relay_id || remote.includes(`/p2p/${relay_id}${CIRCUIT}`)).toBe(true)
    }
  }, 60_000)

  test('a relayed connection runs the DCUtR exchange', async () => {
    const relay = await peers.start({ relay_server: { allowed_peer_ids: [] } })
    const relay_address = await dial_address(relay)
    const unreachable = await peers.start({ listen: [], bootstrap: [relay_address] })
    await wait_until(async () => (await addresses_of(unreachable)).some((address) => address.includes(CIRCUIT)), 15_000)
    const circuit = (await addresses_of(unreachable)).find((address) => address.includes(CIRCUIT)) as string

    const dialer = await peers.start()
    type Handler = (stream: Stream, connection: Connection) => void | Promise<void>
    interface Registrar {
      getHandler: (protocol: string) => { handler: Handler, options: Record<string, unknown> }
      unhandle: (protocol: string) => Promise<void>
      handle: (protocol: string, handler: Handler, options: Record<string, unknown>) => Promise<void>
    }
    const { registrar } = (libp2p_of(dialer) as unknown as { components: { registrar: Registrar } }).components
    const original = registrar.getHandler(DCUTR)
    let exchanged = false
    await registrar.unhandle(DCUTR)
    await registrar.handle(DCUTR, (stream, connection) => {
      exchanged = connection.remoteAddr.toString().includes(CIRCUIT)
      return original.handler(stream, connection)
    }, original.options)

    await libp2p_of(dialer).dial(multiaddr(circuit))
    await wait_until(() => exchanged, 15_000)
  }, 30_000)

  test('a relayed node starts while its relay is down, and reserves whenever the relay comes back', async () => {
    const free_port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number }
        server.close(() => { resolve(port) })
      })
    })
    const relay_key = await seeded_data_dir()
    const relayed_key = await seeded_data_dir()
    const relay_address = `/ip4/127.0.0.1/tcp/${free_port}/p2p/${relay_key.peer_id}`
    const start_relay = async () => await peers.start({ listen: [`/ip4/127.0.0.1/tcp/${free_port}`], relay_server: { allowed_peer_ids: [relayed_key.peer_id] } }, { data_dir: relay_key.data_dir })
    const has_circuit = async () => (await addresses_of(relayed)).some((address) => address.includes(CIRCUIT))

    const relayed = await peers.start(relayed_network(relay_address), { data_dir: relayed_key.data_dir })
    expect(await has_circuit()).toBe(false)

    const relay = await start_relay()
    await wait_until(has_circuit, 25_000)

    await stop_peer(relay)
    await wait_until(async () => !(await has_circuit()), 10_000)
    await start_relay()
    await wait_until(has_circuit, 25_000)
  }, 90_000)
})
