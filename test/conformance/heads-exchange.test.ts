// Heads exchange on a library topic (§5.4.1), against
// src/replication/heads-exchange.ts and a replicator on the in-memory
// network. Manual timers drive the 1000 ms window.

import { afterEach, describe, expect, test } from 'bun:test'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { is_cid_string } from '#encoding/cid.ts'
import type { PubSub } from '#fabric/pubsub.ts'
import { create_heads_publisher, create_heads_receiver } from '#replication/heads-exchange.ts'
import { decode_heads_message, encode_heads_batches, NETWORK_MESSAGE_MAX_BYTES } from '#replication/messages.ts'
import { linear_dag } from '#test/helpers/dag.ts'
import { append_track as append_oplog_track, content_cid_of } from '#test/helpers/library.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'
import { create_replicator_rig } from '#test/helpers/replicator.ts'
import { create_manual_timers } from '#test/helpers/timers.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const many_heads = (count: number) => Array.from({ length: count }, (_, index) => content_cid_of({ head: index }))

// A pubsub that only records what is published, and when.
const recording_pubsub = (now: () => number) => {
  const sent: Array<{ at: number, data: Uint8Array }> = []
  const pubsub = { publish: async (_topic: string, data: Uint8Array) => { sent.push({ at: now(), data }) } } as unknown as PubSub
  return { pubsub, sent }
}

const started_rig = async () => {
  const dag = await linear_dag(0)
  const timers = create_manual_timers()
  const rig = create_replicator_rig({ chain: dag.chain, fetch: async () => undefined, timers })
  await rig.replicator.start()
  timers.advance(0)
  await rig.replicator.idle()
  return { ...rig, dag, timers }
}

describe('heads-exchange', () => {
  test('§5.4.1 [MUST] each heads element is the base58btc CID of a current head', async () => {
    const a = await peers.start()
    const address = a.identity().own_address
    const { entry } = await append_track({ peer: a, fingerprint: 'AQADheads' })
    const observer = peers.network.join({ content_store: create_memory_content_store() })
    await observer.pubsub.subscribe(address, () => {})
    const a_id = (await a.get_settings()).peer_id
    const from_a = () => peers.network.published.filter(({ from, topic }) => from === a_id && topic === address)
    await wait_until(() => from_a().some(({ data }) => decode_heads_message(data)?.heads.includes(entry.hash) === true))
    const heads = decode_heads_message(from_a().at(-1)?.data as Uint8Array)?.heads ?? []
    expect(heads.every(is_cid_string)).toBe(true)
    expect([...heads].sort()).toEqual([...(a.context.libraries.get(address)?.oplog.heads ?? [])].sort())
  })

  test('§5.4.1 [MUST] heads are published on first subscribing to the library topic', async () => {
    const dag = await linear_dag(0)
    const timers = create_manual_timers()
    const rig = create_replicator_rig({ chain: dag.chain, fetch: async () => undefined, timers })
    await rig.replicator.start()
    timers.advance(0)
    await rig.replicator.idle()
    // A peer with no entries still announces its presence.
    expect(rig.published_heads()).toEqual([{ heads: [], incomplete: false }])
  })

  test('§5.4.1 [MUST] heads are published when a new peer joins the topic', async () => {
    const rig = await started_rig()
    rig.timers.advance(1000)
    await rig.remote.pubsub.subscribe(rig.dag.chain.address, () => {})
    await wait_until(() => rig.timers.pending() > 0)
    rig.timers.advance(0)
    await rig.replicator.idle()
    expect(rig.published_heads()).toHaveLength(2)
  })

  test('§5.4.1 [MUST] heads are published when the local heads set changes', async () => {
    const rig = await started_rig()
    rig.timers.advance(1000)
    const entry = append_oplog_track({ oplog: rig.oplog, key_pair: rig.dag.writer, fingerprint: 'AQADchange' })
    rig.replicator.heads_changed()
    rig.timers.advance(0)
    await rig.replicator.idle()
    expect(rig.published_heads().at(-1)).toEqual({ heads: [entry.hash], incomplete: false })
  })

  test('§5.4.1 [MUST] heads are published at most once per 1000 ms per library', async () => {
    const timers = create_manual_timers()
    const { pubsub, sent } = recording_pubsub(timers.now)
    const publisher = create_heads_publisher({ pubsub, topic: 't', interval_ms: 1000, get_heads: () => [], timers })
    const advance = async (ms: number) => {
      timers.advance(ms)
      await publisher.flushed()
      return sent.length
    }
    publisher.trigger()
    expect(await advance(0)).toBe(1)
    await advance(100)
    publisher.trigger()
    expect(await advance(899)).toBe(1)
    expect(await advance(1)).toBe(2)
    await advance(500)
    publisher.trigger()
    expect(await advance(499)).toBe(2)
    expect(await advance(1)).toBe(3)
    const times = sent.map(({ at }) => at)
    expect(times.slice(1).map((at, index) => at - (times[index] as number))).toEqual([1000, 1000])
  })

  test('§5.4.1 [MUST] simultaneous heads triggers coalesce into one message', async () => {
    const timers = create_manual_timers()
    const { pubsub, sent } = recording_pubsub(timers.now)
    const publisher = create_heads_publisher({ pubsub, topic: 't', interval_ms: 1000, get_heads: () => [], timers })
    for (let count = 0; count < 5; count++) publisher.trigger()
    timers.advance(0)
    await publisher.flushed()
    expect(sent).toHaveLength(1)
    // Triggers inside the window coalesce into the next message.
    for (let count = 0; count < 5; count++) publisher.trigger()
    timers.advance(1000)
    await publisher.flushed()
    expect(sent).toHaveLength(2)
  })

  test('§5.4.1 [MUST] a heads message does not exceed 256 KiB of JSON', () => {
    const messages = encode_heads_batches({ heads: many_heads(6000) })
    expect(messages.length).toBeGreaterThan(1)
    for (const data of messages) expect(data.length).toBeLessThanOrEqual(NETWORK_MESSAGE_MAX_BYTES)
  })

  test('§5.4.1 [MUST] an oversized heads set splits across messages from the same trigger', async () => {
    const heads = many_heads(6000)
    const timers = create_manual_timers()
    const { pubsub, sent } = recording_pubsub(timers.now)
    const publisher = create_heads_publisher({ pubsub, topic: 't', interval_ms: 1000, get_heads: () => heads, timers })
    publisher.trigger()
    timers.advance(0)
    await publisher.flushed()
    expect(sent.length).toBeGreaterThan(1)
    expect(new Set(sent.map(({ at }) => at)).size).toBe(1)
    expect(sent.flatMap(({ data }) => decode_heads_message(data)?.heads ?? [])).toEqual(heads)
  })

  test('§5.4.1 [MUST] every split heads message but the last carries incomplete: true', () => {
    const messages = encode_heads_batches({ heads: many_heads(6000) }).map((data) => JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>)
    expect(messages.slice(0, -1).every(({ incomplete }) => incomplete === true)).toBe(true)
    expect('incomplete' in (messages.at(-1) as object)).toBe(false)
    expect(encode_heads_batches({ heads: [] }).map((data) => new TextDecoder().decode(data))).toEqual(['{"type":"heads","heads":[]}'])
  })

  test('§5.4.1 [MUST] receivers treat a split batch as complete only after the message without incomplete: true', () => {
    const heads = many_heads(6000)
    const parts = encode_heads_batches({ heads })
    const snapshots: Array<{ from: string, heads: readonly string[] }> = []
    const receive = create_heads_receiver({ on_snapshot: (snapshot) => { snapshots.push(snapshot) } })
    for (const data of parts.slice(0, -1)) receive({ from: 'x', data })
    expect(snapshots).toEqual([])
    // Another sender's complete message does not complete x's batch.
    receive({ from: 'y', data: encode_heads_batches({ heads: [heads[0] as string] })[0] as Uint8Array })
    expect(snapshots).toEqual([{ from: 'y', heads: [heads[0] as string] }])
    receive({ from: 'x', data: parts.at(-1) as Uint8Array })
    expect(snapshots[1]).toEqual({ from: 'x', heads })
  })
})
