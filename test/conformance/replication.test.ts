// Merge, disconnect, and unreachable peers (§5.4.3-§5.4.5), against a
// replicator on the in-memory network and between peers on it.

import { afterEach, describe, expect, test } from 'bun:test'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { compute_heads } from '#oplog/heads.ts'
import { create_oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import type { Peer } from '#peer/peer.ts'
import type { PeerEvent } from '#types/peer.ts'
import { hanging_fetch, linear_dag, nth, traverse } from '#test/helpers/dag.ts'
import { append_track as append_oplog_track, content_cid_of, oplog_state, open_test_library } from '#test/helpers/library.ts'
import { append_track, create_memory_peers, wait_for_event, wait_until } from '#test/helpers/network.ts'
import { create_replicator_rig } from '#test/helpers/replicator.ts'
import { create_manual_timers } from '#test/helpers/timers.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const jitter = async () => {
  for (let turns = Math.floor(Math.random() * 4); turns > 0; turns--) await new Promise((resolve) => setImmediate(resolve))
}

// Two writers' concurrent branches of one library, touching the same keys.
const concurrent_branches = async () => {
  const writers = [generate_key_pair(), generate_key_pair()]
  const { chain } = await open_test_library({ writers })
  const branches = writers.map((key_pair, branch) => {
    const fork = create_oplog({ chain })
    for (let index = 0; index < 4; index++) {
      append_oplog_track({ oplog: fork, key_pair, fingerprint: `AQADshared${index % 2}`, content: { branch, index } })
    }
    return fork
  })
  const blocks = new Map(branches.flatMap((fork) => [...fork.entries.values()].map(({ hash, bytes }) => [hash, bytes] as const)))
  const sequential = create_oplog({ chain })
  merge_entries({ oplog: sequential, blocks: [...blocks.values()] })
  return { chain, branches, blocks, sequential }
}

// B replicating A's library over the in-memory network, with B's events kept.
const replicating_pair = async () => {
  const a = await peers.start()
  const b = await peers.start()
  const address = a.identity().own_address
  const first = await append_track({ peer: a, fingerprint: 'AQADfirst' })
  const added = wait_for_event(b, ({ type, payload }) => type === 'track:added' && payload.library_address === address)
  await b.link_library({ address, alias: null })
  await added
  const events: PeerEvent[] = []
  b.subscribe((event) => { events.push(event) })
  return { a, b, address, first, events }
}

const oplog_of = (peer: Peer, address: string) => {
  const oplog = peer.context.libraries.get(address)?.oplog
  if (oplog === undefined) throw new Error(`library not open: ${address}`)
  return oplog
}

const QUERY = { offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' } as const
const track_ids = async (peer: Peer, address: string) =>
  (await peer.list_tracks({ ...QUERY, library_addresses: [address] })).items.map(({ id }) => id).sort()

describe('replication', () => {
  test('§5.4.3 [MUST] incremental merge batches never include entries with unfetched ancestors', async () => {
    const dag = await linear_dag(6)
    // Later entries answer first, so descendants arrive before ancestors.
    const position = new Map(dag.entries.map(({ hash }, index) => [hash, index]))
    const rig = create_replicator_rig({
      chain: dag.chain,
      fetch: async (hash) => {
        for (let turns = 6 - (position.get(hash) ?? 0); turns > 0; turns--) await new Promise((resolve) => setImmediate(resolve))
        return dag.blocks.get(hash)
      }
    })
    await rig.replicator.start()
    await rig.send_heads([nth(dag.entries, 5).hash])
    await rig.replicator.idle()
    const landed = new Set<string>()
    for (const batch of rig.batches) {
      const in_batch = new Set(batch.map(({ hash }) => hash))
      for (const { entry } of batch) {
        for (const parent of entry.next) expect(landed.has(parent) || in_batch.has(parent)).toBe(true)
      }
      for (const hash of in_batch) landed.add(hash)
    }
    expect(rig.oplog.entries.size).toBe(6)
  })

  test('§5.4.3 [MUST] concurrent heads messages for one library end in a state equal to some sequential merge order', async () => {
    const { chain, branches, blocks, sequential } = await concurrent_branches()
    const rig = create_replicator_rig({
      chain,
      fetch: async (hash) => {
        await jitter()
        return blocks.get(hash)
      }
    })
    const other = rig.network.join({ content_store: create_memory_content_store() })
    await rig.replicator.start()
    await Promise.all(branches.map(async (fork, index) => { await rig.send_heads([...fork.heads], index === 0 ? rig.remote : other) }))
    await rig.replicator.idle()
    expect(oplog_state(rig.oplog)).toEqual(oplog_state(sequential))
  })

  test('§5.4.3 [MUST] parallelised merges uphold the §4.5 invariants', async () => {
    const { chain, branches, blocks, sequential } = await concurrent_branches()
    const rig = create_replicator_rig({
      chain,
      concurrency: 4,
      fetch: async (hash) => {
        await jitter()
        return blocks.get(hash)
      },
      merge_delay: jitter
    })
    await rig.replicator.start()
    await Promise.all(branches.map(async (fork) => { await rig.send_heads([...fork.heads]) }))
    await rig.replicator.idle()
    // Fetches overlap, merges never do.
    expect(rig.peak_merging()).toBe(1)
    expect(rig.oplog.heads).toEqual(compute_heads(rig.oplog.entries.values()))
    expect(oplog_state(rig.oplog)).toEqual(oplog_state(sequential))
  })

  test('§5.4.4 [MUST] replication pauses for one library without closing its log', async () => {
    const { a, b, address } = await replicating_pair()
    const b_own = b.identity().own_address
    await b.disconnect_library(address)
    expect(b.context.replication?.get(address)?.state()).toBe('paused')
    expect(b.context.replication?.get(b_own)?.state()).toBe('running')
    // The log stays open: queries read it and the library is still listed.
    expect(await track_ids(b, address)).toHaveLength(1)
    expect((await b.get_library(address))?.is_loading_index).toBe(false)
    const second = await append_track({ peer: a, fingerprint: 'AQADsecond' })
    const b_id = (await b.get_settings()).peer_id
    await wait_until(() => peers.network.delivered.some(({ to, topic }) => to === b_id && topic === address))
    expect(oplog_of(b, address).entries.has(second.entry.hash)).toBe(false)
    const added = wait_for_event(b, ({ type, payload }) => type === 'track:added' && payload.library_address === address)
    await b.connect_library(address)
    await added
    expect(oplog_of(b, address).entries.has(second.entry.hash)).toBe(true)
  })

  test('§5.4.4 [MUST] pause stops heads publishing and new fetch tasks while in-flight fetches finish or time out', async () => {
    const dag = await linear_dag(2)
    const root = nth(dag.entries, 0)
    const tip = nth(dag.entries, 1)
    const timers = create_manual_timers()
    let release: (() => void) | undefined
    const rig = create_replicator_rig({
      chain: dag.chain,
      timers,
      fetch: async (hash) => {
        if (hash === tip.hash) await new Promise<void>((resolve) => { release = resolve })
        return dag.blocks.get(hash)
      }
    })
    await rig.replicator.start()
    timers.advance(0)
    await rig.send_heads([tip.hash])
    expect(rig.log.filter((line) => line.startsWith('fetch:'))).toEqual([`fetch:${tip.hash}`])
    rig.replicator.pause()
    const published = rig.published_heads().length
    rig.replicator.heads_changed()
    timers.advance(5000)
    await rig.send_heads([root.hash])
    // Neither a heads message nor a new fetch since the pause.
    expect(rig.published_heads()).toHaveLength(published)
    expect(rig.log.filter((line) => line.startsWith('fetch:'))).toEqual([`fetch:${tip.hash}`])
    // The in-flight fetch still completes, and its parent waits for resume.
    release?.()
    await rig.replicator.idle()
    expect(rig.replicator.traversal.enqueued.has(tip.hash)).toBe(true)
    expect(rig.log.filter((line) => line.startsWith('fetch:'))).toEqual([`fetch:${tip.hash}`])
    expect(rig.oplog.entries.size).toBe(0)
  })

  test('§5.4.4 [MUST] entries in flight at pause are recorded as unresolved', async () => {
    const dag = await linear_dag(1)
    const { hash } = nth(dag.entries, 0)
    const { traversal } = traverse({ chain: dag.chain, fetch: hanging_fetch, timeout_ms: 60_000 })
    traversal.enqueue([hash])
    expect(traversal.unresolved()).toEqual([])
    traversal.pause()
    expect(traversal.unresolved()).toEqual([hash])
    traversal.discard()
  })

  test('§5.4.4 [MUST] resume re-enters traversal for unresolved entries before publishing heads', async () => {
    const dag = await linear_dag(1)
    const { hash } = nth(dag.entries, 0)
    const timers = create_manual_timers()
    let reachable = false
    const rig = create_replicator_rig({
      chain: dag.chain,
      timers,
      fetch: async (fetched, options) => reachable ? dag.blocks.get(fetched) : await hanging_fetch(fetched, options)
    })
    await rig.replicator.start()
    timers.advance(0)
    await rig.send_heads([hash])
    rig.replicator.pause()
    timers.advance(10_000)
    expect(rig.replicator.traversal.unresolved()).toEqual([hash])
    reachable = true
    const mark = rig.log.length
    rig.replicator.resume()
    timers.advance(0)
    await rig.replicator.idle()
    expect(rig.log.slice(mark)).toEqual([`fetch:${hash}`, `publish:${dag.chain.address}`])
    expect(rig.oplog.entries.has(hash)).toBe(true)
  })

  test('§5.4.4 [MUST] resume does not re-fetch entries that already landed', async () => {
    const dag = await linear_dag(1)
    const entry = nth(dag.entries, 0)
    const timers = create_manual_timers()
    const rig = create_replicator_rig({ chain: dag.chain, timers, fetch: hanging_fetch })
    await rig.replicator.start()
    await rig.send_heads([entry.hash])
    rig.replicator.pause()
    timers.advance(10_000)
    // The entry lands by another route while replication is paused.
    merge_entries({ oplog: rig.oplog, blocks: [entry.bytes] })
    const mark = rig.log.length
    rig.replicator.resume()
    timers.advance(0)
    await rig.replicator.idle()
    expect(rig.log.slice(mark).filter((line) => line.startsWith('fetch:'))).toEqual([])
    expect(rig.replicator.traversal.unresolved()).toEqual([])
  })

  test('§5.4.5 [MUST] heads referencing unfetchable CIDs are tolerated', async () => {
    const dag = await linear_dag(1)
    const known = nth(dag.entries, 0)
    const unfetchable = content_cid_of({ never: 'stored' })
    const not_an_entry = content_cid_of({ not: 'an entry' })
    const rig = create_replicator_rig({
      chain: dag.chain,
      fetch: async (hash) => hash === not_an_entry ? new Uint8Array([0xa0]) : dag.blocks.get(hash)
    })
    await rig.replicator.start()
    await rig.send_heads([unfetchable, not_an_entry, known.hash])
    await rig.replicator.idle()
    expect(rig.replicator.state()).toBe('running')
    expect(rig.replicator.traversal.unresolved()).toEqual([unfetchable])
    expect(rig.replicator.traversal.rejected.has(not_an_entry)).toBe(true)
    expect([...rig.oplog.entries.keys()]).toEqual([known.hash])
  })

  test('§5.4.5 [MUST] a per-entry timeout does not stall the replicator', async () => {
    const dag = await linear_dag(1)
    const reachable = nth(dag.entries, 0)
    const stuck = content_cid_of({ stuck: true })
    const rig = create_replicator_rig({
      chain: dag.chain,
      concurrency: 1,
      timeout_ms: 30,
      fetch: async (hash, options) => hash === stuck ? await hanging_fetch(hash, options) : dag.blocks.get(hash)
    })
    await rig.replicator.start()
    await rig.send_heads([stuck])
    await rig.send_heads([reachable.hash])
    await rig.replicator.idle()
    expect(rig.oplog.entries.has(reachable.hash)).toBe(true)
    expect(rig.replicator.traversal.unresolved()).toEqual([stuck])
  })

  test('§5.4.5 [MUST] an unreachable library keeps its local oplog', async () => {
    const { a, b, address, first } = await replicating_pair()
    const a_id = (await a.get_settings()).peer_id
    peers.network.set_serving({ peer_id: a_id, serving: false })
    const second = await append_track({ peer: a, fingerprint: 'AQADunreachable' })
    await wait_until(() => b.context.replication?.get(address)?.traversal.unresolved().includes(second.entry.hash) === true)
    expect([...oplog_of(b, address).entries.keys()]).toContain(first.entry.hash)
    expect(oplog_of(b, address).entries.has(second.entry.hash)).toBe(false)
    expect(await track_ids(b, address)).toHaveLength(1)
    // On reconnection it resumes from the heads it knew.
    peers.network.set_serving({ peer_id: a_id, serving: true })
    const added = wait_for_event(b, ({ type, payload }) => type === 'track:added' && payload.library_address === address)
    await append_track({ peer: a, fingerprint: 'AQADreconnected' })
    await added
    await wait_until(() => oplog_of(b, address).entries.has(second.entry.hash))
  })

  test('§5.4.5 [MUST] fetch failures never emit a library-removed signal', async () => {
    const { a, b, address, events } = await replicating_pair()
    peers.network.set_serving({ peer_id: (await a.get_settings()).peer_id, serving: false })
    const second = await append_track({ peer: a, fingerprint: 'AQADfailing' })
    await wait_until(() => b.context.replication?.get(address)?.traversal.unresolved().includes(second.entry.hash) === true)
    expect(events.filter(({ type }) => type === 'library:unlinked' || type === 'track:removed')).toEqual([])
    expect((await b.get_library(address))?.is_linked).toBe(true)
  })
})
