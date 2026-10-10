// The §5.6 modes on loopback: the own-peers relay's reservation gate, a
// relayed node that advertises and dials only through its relay yet is found
// by peer id and replicates, the DCUtR exchange over a relayed connection,
// the §5.6.4 agent string, and the peer allowlist.

import { afterEach, describe, expect, test } from 'bun:test'
import { createServer } from 'node:net'

import type { Connection, Stream } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr'

import type { NetworkConfig } from '#adapter/libp2p/config.ts'
import { agent_string, keep_relay_reservation, type RecordLibp2p } from '#adapter/libp2p/node.ts'
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

// A dialer negotiates its muxer optimistically, so a dial the far side's
// gater refuses may still resolve before that side aborts it. Refused means
// no connection survives and no protocol runs over one.
const refuses_dial = async (from: Peer, address: Multiaddr, to_peer_id: string) => {
  await libp2p_of(from).dial(address).catch(() => undefined)
  await expect(libp2p_of(from).services.ping.ping(address)).rejects.toThrow()
  await wait_until(() => !libp2p_of(from).getConnections().some(({ remotePeer }) => remotePeer.toString() === to_peer_id))
}
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
  }, 15_000)

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

  test('the relay reservation keeper refreshes on its own clock even while the stale circuit address is still listed', async () => {
    // Simulates the 2026-10-10 finding: a lapsed reservation that does not
    // clear the local circuit address, so the only-while-missing check never
    // fires. getMultiaddrs() keeps returning a circuit address throughout;
    // the keeper must still force a re-listen once refresh_after_ms elapses.
    const relay_address = '/ip4/127.0.0.1/tcp/4001/p2p/12D3KooWG5Ks3bMTkPu7TAqs876nMJ3n7XWLuB63f1TdLZnxYaFi'
    const circuit = multiaddr(`${relay_address}${CIRCUIT}`)
    let listen_calls = 0
    let stop_handler: (() => void) | undefined
    const fake_libp2p = {
      status: 'started',
      getMultiaddrs: () => [circuit],
      addEventListener: (event: string, handler: () => void) => { if (event === 'stop') stop_handler = handler },
      components: {
        transportManager: {
          getListeners: () => [],
          listen: async () => { listen_calls++ }
        }
      }
    } as unknown as RecordLibp2p

    keep_relay_reservation(fake_libp2p, relay_address, { check_interval_ms: 5, refresh_after_ms: 20 })
    try {
      await wait_until(() => listen_calls >= 2, 2000)
    } finally {
      stop_handler?.()
    }
  })

  test('a node with a peer allowlist connects to and accepts only its listed peers', async () => {
    const listed_key = await seeded_data_dir()
    const closed = await peers.start({ peer_allowlist: [listed_key.peer_id] })
    const closed_address = await dial_address(closed)
    const listed = await peers.start({}, { data_dir: listed_key.data_dir })
    const unlisted = await peers.start()
    const closed_id = libp2p_of(closed).peerId.toString()

    await libp2p_of(listed).services.ping.ping(multiaddr(closed_address))
    await refuses_dial(unlisted, multiaddr(closed_address), closed_id)
    await expect(libp2p_of(closed).dial(multiaddr(await dial_address(unlisted)))).rejects.toThrow()
    expect(libp2p_of(closed).getConnections().map(({ remotePeer }) => remotePeer.toString())).toEqual([listed_key.peer_id])
  }, 30_000)

  test('a relayed node with a peer allowlist keeps its relay and refuses unlisted peers through it', async () => {
    const closed_key = await seeded_data_dir()
    const listed_key = await seeded_data_dir()
    const relay = await peers.start({ relay_server: { allowed_peer_ids: [closed_key.peer_id] } })
    const relay_address = await dial_address(relay)
    // The relay is not listed, and still passes.
    const closed = await peers.start({ ...relayed_network(relay_address), peer_allowlist: [listed_key.peer_id] }, { data_dir: closed_key.data_dir })
    await wait_until(async () => (await addresses_of(closed)).some((address) => address.includes(CIRCUIT)), 15_000)
    const circuit = multiaddr(`${relay_address}${CIRCUIT}/p2p/${closed_key.peer_id}`)

    const unlisted = await peers.start()
    await refuses_dial(unlisted, circuit, closed_key.peer_id)
    const listed = await peers.start({}, { data_dir: listed_key.data_dir })
    await libp2p_of(listed).services.ping.ping(circuit)
  }, 60_000)
})
