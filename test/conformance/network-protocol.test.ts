// Discovery, topics, and the libp2p profile (§5.2, §5.3.1, §5.5), plus the F6
// message vectors against src/replication/messages.ts and the F7 import
// vectors against the Helia content store. Announcements, heads exchange, and
// replication have their own files. libp2p peers run in-process on loopback.

import { afterEach, describe, expect, test } from 'bun:test'
import type { Libp2p } from '@libp2p/interface'
import { mdns } from '@libp2p/mdns'
import { preSharedKey } from '@libp2p/pnet'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { createLibp2p } from 'libp2p'

import { create_libp2p_options, RECORD_SWARM_KEY, type NetworkedHelia } from '#adapter/libp2p/node.ts'
import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { create_memory_network } from '#adapter/memory/network.ts'
import { sha256_hex } from '#encoding/sha256.ts'
import { compute_about_id } from '#entry/id.ts'
import { assert_signed_entry_shape } from '#entry/signed.ts'
import { RECORD_TOPIC, type PubSubMessage } from '#fabric/pubsub.ts'
import type { Peer } from '#peer/peer.ts'
import { build_loaded_about_entry, encode_heads_message } from '#replication/messages.ts'
import { create_replicator } from '#replication/replicator.ts'
import { SYSTEM_TIMERS } from '#replication/timers.ts'
import { open_offline_helia_store } from '#test/helpers/helia.ts'
import { create_libp2p_peers, dial_address, LOOPBACK } from '#test/helpers/libp2p.ts'
import { content_cid_of, open_test_library } from '#test/helpers/library.ts'
import { append_track, create_memory_peers, wait_for_event, wait_until } from '#test/helpers/network.ts'
import {
  audio_pipeline_vector,
  build_multi_block_input,
  heads_message_vector,
  loaded_about_entry_vector,
  multi_block_vector,
  NETWORK_MESSAGE_SIZE_BOUND,
  signed_entry_vector
} from './vectors.ts'

const import_with_helia = async (source: string | Uint8Array) => {
  const { helia, content_store } = await open_offline_helia_store()
  try {
    return await content_store.import_blob(source)
  } finally {
    await helia.stop()
  }
}

const libp2p_peers = create_libp2p_peers()
const memory_peers = create_memory_peers()
afterEach(async () => {
  await libp2p_peers.stop_all()
  await memory_peers.stop_all()
})

const libp2p_of = (peer: Peer) => (peer.context.store.helia as NetworkedHelia).libp2p
const connected = (peer: Peer, other: Peer) => libp2p_of(peer).getConnections(libp2p_of(other).peerId).length > 0

describe('network-protocol', () => {
  test('§5.2 [MUST] the peer bootstraps from any one discovery mechanism alone', async () => {
    // The shared bootstrap list alone.
    const seed = await libp2p_peers.start()
    const joiner = await libp2p_peers.start({ bootstrap: [await dial_address(seed)] })
    await wait_until(() => connected(joiner, seed))
    // Local-network discovery alone, on the profile's options with a service
    // tag unique to this run, so no other node on the LAN ever answers.
    const service_tag = `_record-test-${process.pid}-${Date.now()}._udp.local`
    const nodes = await Promise.all([0, 1].map(async () => await createLibp2p({
      ...create_libp2p_options(LOOPBACK),
      peerDiscovery: [mdns({ serviceTag: service_tag, interval: 500 })]
    } as unknown as Parameters<typeof createLibp2p>[0])))
    // Every discovery dials; stopping a node with a dial still in flight
    // aborts its socket, so the dials stop and settle before the nodes do.
    const dials: Array<Promise<unknown>> = []
    const listeners = nodes.map((node) => {
      const listener = ({ detail }: CustomEvent<{ id: Parameters<Libp2p['dial']>[0] }>) => { dials.push(node.dial(detail.id).catch(() => {})) }
      node.addEventListener('peer:discovery', listener as never)
      return listener
    })
    try {
      const [first, second] = nodes as [Libp2p, Libp2p]
      await wait_until(() => first.getConnections(second.peerId).length > 0 && second.getConnections(first.peerId).length > 0)
    } finally {
      nodes.forEach((node, index) => { node.removeEventListener('peer:discovery', listeners[index] as never) })
      await Promise.allSettled(dials)
      for (const node of nodes) await node.stop()
    }
  })

  test('§5.2 [MUST] content-network native discovery is supported', async () => {
    // B and C each know only the hub; B finds C through the DHT.
    const hub = await libp2p_peers.start({ dht: true })
    const hub_address = await dial_address(hub)
    const b = await libp2p_peers.start({ dht: true, bootstrap: [hub_address] })
    const c = await libp2p_peers.start({ dht: true, bootstrap: [hub_address] })
    await wait_until(() => connected(b, hub) && connected(c, hub))
    expect(connected(b, c)).toBe(false)
    let found: Awaited<ReturnType<ReturnType<typeof libp2p_of>['peerRouting']['findPeer']>> | undefined
    await wait_until(async () => {
      found = await libp2p_of(b).peerRouting.findPeer(libp2p_of(c).peerId, { signal: AbortSignal.timeout(2000) }).catch(() => undefined)
      return found !== undefined
    })
    expect(found?.multiaddrs.length).toBeGreaterThan(0)
    await libp2p_of(b).dial(libp2p_of(c).peerId)
    expect(connected(b, c)).toBe(true)
  })

  test('§5.3.1 [MUST] peers publish and subscribe to topic RECORD, bytes 52 45 43 4f 52 44', async () => {
    expect([...utf8ToBytes(RECORD_TOPIC)]).toEqual([0x52, 0x45, 0x43, 0x4f, 0x52, 0x44])
    const peer = await memory_peers.start()
    const address = peer.identity().own_address
    await peer.set_about({ address, fields: { name: 'A' } })
    const peer_id = (await peer.get_settings()).peer_id
    const observer = memory_peers.network.join({ content_store: create_memory_content_store() })
    const received: PubSubMessage[] = []
    await observer.pubsub.subscribe('RECORD', (message) => { received.push(message) })
    expect(observer.pubsub.subscribers('RECORD')).toContain(peer_id)
    await wait_until(() => received.some(({ from }) => from === peer_id))
    // The same over gossipsub.
    const networked = await libp2p_peers.start()
    expect(libp2p_of(networked).services.pubsub.getTopics()).toContain('RECORD')
  })

  test('§5.3.1 [MUST] a library topic too long for the pubsub runtime surfaces an error instead of truncating or hashing', async () => {
    const network = create_memory_network()
    const local = network.join({ content_store: create_memory_content_store(), max_topic_bytes: 64 })
    const observer = network.join({ content_store: create_memory_content_store() })
    const { oplog } = await open_test_library()
    const address = oplog.chain.address
    expect(address.length).toBeGreaterThan(64)
    const replicator = create_replicator({
      oplog,
      pubsub: local.pubsub,
      fetch_block: async () => undefined,
      merge: async () => {},
      concurrency: 4,
      timeout_ms: 1000,
      heads_interval_ms: 1000,
      timers: SYSTEM_TIMERS
    })
    await expect(replicator.start()).rejects.toMatchObject({ code: 'topic_too_long' })
    expect(replicator.state()).toBe('idle')
    // Nothing was subscribed or published under a shortened name.
    for (const topic of [address, address.slice(0, 64), sha256_hex(address)]) expect(observer.pubsub.subscribers(topic)).toEqual([])
    expect(network.published).toEqual([])
  })
  test('§5.3.2 [vector] F6 LoadedAboutEntry inlines the about payload and serialises to 1060 bytes', () => {
    const { message } = loaded_about_entry_vector
    const about_content = message.payload.value.content
    expect<string>(message.payload.key).toBe(compute_about_id(about_content.address))
    // The signed entry carries the about content CID; the announcement inlines the payload.
    const { hash, payload, ...fields } = message
    const entry = assert_signed_entry_shape({
      ...fields,
      payload: { ...payload, value: { ...payload.value, content: content_cid_of(about_content) } }
    })
    const loaded = build_loaded_about_entry({ hash, entry, about_content })
    const json = JSON.stringify(loaded)
    expect(Buffer.byteLength(json)).toBe(loaded_about_entry_vector.json_byte_length)
    expect(json).toBe(JSON.stringify(message))
  })
  test('§5.4.1 [vector] the single-entry heads message is the 122-byte spec JSON', () => {
    const json = encode_heads_message({ heads: [signed_entry_vector.entry_hash] })
    expect(json).toBe(heads_message_vector.json)
    expect(Buffer.byteLength(json)).toBe(heads_message_vector.json_byte_length)
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(NETWORK_MESSAGE_SIZE_BOUND)
  })
  test('§5.5 [MUST] the peer implements the §5.5.1 libp2p profile', async () => {
    const a = await libp2p_peers.start()
    const b = await libp2p_peers.start({ bootstrap: [await dial_address(a)] })
    const { entry } = await append_track({ peer: a, fingerprint: 'AQADprofile' })
    const address = a.identity().own_address
    const added = wait_for_event(b, ({ type, payload }) => type === 'track:added' && payload.library_address === address)
    await b.link_library({ address, alias: null })
    await added
    expect(b.context.libraries.get(address)?.oplog.entries.get(entry.hash)?.bytes).toEqual(entry.bytes)
  })

  test('§5.5.1 [MUST] the pubsub router is gossipsub', async () => {
    const a = await libp2p_peers.start()
    const b = await libp2p_peers.start({ bootstrap: [await dial_address(a)] })
    await wait_until(() => connected(b, a))
    expect(libp2p_of(a).getProtocols().filter((protocol) => protocol.startsWith('/meshsub/')).length).toBeGreaterThan(0)
    // The remote side speaks it too, as identify reports.
    await wait_until(async () => (await libp2p_of(b).peerStore.get(libp2p_of(a).peerId)).protocols.some((protocol) => protocol.startsWith('/meshsub/')))
    // And gossipsub carries the RECORD subscription between them.
    await wait_until(() => libp2p_of(b).services.pubsub.getSubscribers(RECORD_TOPIC).some((peer) => peer.equals(libp2p_of(a).peerId)))
  })

  test('§5.5.1 [MUST] the swarm uses the Record pre-shared key', async () => {
    const record_peer = await libp2p_peers.start()
    const target = libp2p_of(record_peer).getMultiaddrs()[0]
    if (target === undefined) throw new Error('no listen address')
    const other_key = RECORD_SWARM_KEY.replace(/[0-9a-f]{64}$/, 'ab'.repeat(32))
    const base = create_libp2p_options({ ...LOOPBACK, listen: [] })
    const variants = {
      record: base,
      other_key: { ...base, connectionProtector: preSharedKey({ psk: utf8ToBytes(other_key) }) },
      no_key: { ...base, connectionProtector: undefined }
    }
    const results: Record<string, boolean> = {}
    for (const [name, options] of Object.entries(variants)) {
      const node = await createLibp2p(options as unknown as Parameters<typeof createLibp2p>[0])
      try {
        results[name] = await node.dial(target, { signal: AbortSignal.timeout(3000) }).then(() => true, () => false)
      } finally {
        await node.stop()
      }
    }
    expect(results).toEqual({ record: true, other_key: false, no_key: false })
  })
  test('§5.5.1 [vector] F7 the fixture audio imports with unixfs-v1-2025 to its base58btc content.hash', async () => {
    expect(await import_with_helia(audio_pipeline_vector.fixture_path)).toBe(audio_pipeline_vector.audio_cid)
  })
  test('§5.5.1 [vector] F7 a 2 MiB+1 blob imports with unixfs-v1-2025 to the multi-block CID', async () => {
    expect(await import_with_helia(build_multi_block_input())).toBe(multi_block_vector.cid)
  })
})
