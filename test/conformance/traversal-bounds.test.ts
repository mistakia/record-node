// Bounded fetch traversal (§5.4.2), against src/replication/traversal.ts and
// the merge orchestration that only takes entries whose ancestors landed.
// The fan-out cap is part of entry verification (src/entry, src/oplog).

import { describe, expect, test } from 'bun:test'

import { build_unsigned_entry, MAX_ENTRY_POINTERS } from '#entry/build.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { create_oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { create_merge_orchestrator } from '#replication/merge-orchestrator.ts'
import { create_traversal } from '#replication/traversal.ts'
import { SYSTEM_TIMERS } from '#replication/timers.ts'
import { fan_in_dag, hanging_fetch, linear_dag, nth, traverse } from '#test/helpers/dag.ts'
import { content_cid_of, open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'

const writer = generate_key_pair()
const hashes = (count: number) => Array.from({ length: count }, (_, index) => content_cid_of({ index }))

describe('traversal-bounds', () => {
  test('§5.4.2 [MUST] traversal tracks the set of enqueued entry hashes', async () => {
    const dag = await fan_in_dag(3)
    const { traversal, fetches } = traverse({ chain: dag.chain, fetch: async (hash) => dag.blocks.get(hash) })
    traversal.enqueue([dag.top.hash])
    await traversal.idle()
    // The top and its three branches, each fetched once.
    expect([...traversal.enqueued].sort()).toEqual([...dag.blocks.keys()].sort())
    expect([...fetches].sort()).toEqual([...dag.blocks.keys()].sort())
    // A later heads message naming known hashes enqueues nothing new.
    traversal.enqueue([dag.top.hash, ...dag.branches.map(({ hash }) => hash)])
    await traversal.idle()
    expect(fetches).toHaveLength(4)
  })

  test('§5.4.2 [MUST] an already-enqueued entry is never re-enqueued, so a cycle terminates', async () => {
    // Signed entries cannot form a cycle, so a hostile peer's cyclic graph is
    // modelled with entries the verifier takes at face value.
    const graph: Record<string, { next: string[], refs: string[] }> = {
      a: { next: ['b'], refs: [] },
      b: { next: ['c'], refs: ['a'] },
      c: { next: ['a'], refs: ['b'] }
    }
    const fetches: string[] = []
    const traversal = create_traversal({
      fetch: async (hash) => {
        fetches.push(hash)
        return new TextEncoder().encode(hash)
      },
      verify: (hash) => ({ hash, entry: graph[hash] as { next: string[], refs: string[] } }),
      is_landed: () => false,
      on_entry: () => {},
      concurrency: 4,
      timeout_ms: 1000,
      timers: SYSTEM_TIMERS
    })
    traversal.enqueue(['a'])
    await traversal.idle()
    expect(fetches.sort()).toEqual(['a', 'b', 'c'])
  })
  test('§5.4.2 [MUST] next and refs each hold at most 256 elements', () => {
    const clock = { id: writer.public_key, time: 1 }
    const entry = (next: string[], refs: string[]) => build_unsigned_entry({ id: '/record/x/library', payload: {}, next, refs, clock })
    expect(entry(hashes(MAX_ENTRY_POINTERS), hashes(MAX_ENTRY_POINTERS)).next.length).toBe(256)
    expect(() => entry(hashes(MAX_ENTRY_POINTERS + 1), [])).toThrow('next holds 257 hashes')
    expect(() => entry([], hashes(MAX_ENTRY_POINTERS + 1))).toThrow('refs holds 257 hashes')
  })

  test('§5.4.2 [MUST] an entry with more than 256 next or refs is rejected at signature verification', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const fan_out = (field: 'next' | 'refs') => sign_raw({
      private_key: writer.private_key,
      fields: { id: oplog.chain.address, payload: track_put(), [field]: hashes(MAX_ENTRY_POINTERS + 1), clock: { id: writer.public_key, time: 1 } }
    }).bytes
    // Validly signed by a listed writer, and still rejected.
    const { merged, rejected } = merge_entries({ oplog, blocks: [fan_out('next'), fan_out('refs')] })
    expect(merged).toEqual([])
    expect(rejected.map(({ code }) => code)).toEqual(['size_exceeded', 'size_exceeded'])
  })

  test('§5.4.2 [MUST] a rejected fan-out entry enqueues none of its children', async () => {
    const { chain } = await open_test_library({ writers: [writer] })
    const children = hashes(MAX_ENTRY_POINTERS + 1)
    const fan_out = sign_raw({
      private_key: writer.private_key,
      fields: { id: chain.address, payload: track_put(), next: children, clock: { id: writer.public_key, time: 1 } }
    })
    const { traversal, fetches, verified } = traverse({ chain, fetch: async (hash) => hash === fan_out.hash ? fan_out.bytes : undefined })
    traversal.enqueue([fan_out.hash])
    await traversal.idle()
    expect(traversal.rejected.get(fan_out.hash)?.code).toBe('size_exceeded')
    expect(verified).toEqual([])
    expect(fetches).toEqual([fan_out.hash])
    expect([...traversal.enqueued]).toEqual([fan_out.hash])
  })

  test('§5.4.2 [MUST] in-flight fetches per library are bounded by a finite limit', async () => {
    const dag = await fan_in_dag(12)
    let in_flight = 0
    let peak = 0
    const { traversal } = traverse({
      chain: dag.chain,
      concurrency: 3,
      fetch: async (hash) => {
        peak = Math.max(peak, ++in_flight)
        await new Promise((resolve) => setImmediate(resolve))
        in_flight--
        return dag.blocks.get(hash)
      }
    })
    traversal.enqueue([dag.top.hash])
    await traversal.idle()
    expect(peak).toBe(3)
    expect(traversal.enqueued.size).toBe(13)
    const options = { fetch: hanging_fetch, verify: () => { throw new Error('unused') }, is_landed: () => false, on_entry: () => {}, timeout_ms: 1000, timers: SYSTEM_TIMERS }
    expect(() => create_traversal({ ...options, concurrency: Infinity })).toThrow('finite positive integer')
    expect(() => create_traversal({ ...options, concurrency: 0 })).toThrow('finite positive integer')
  })

  test('§5.4.2 [MUST] each fetch has a finite timeout', async () => {
    const dag = await linear_dag(1)
    const signals: AbortSignal[] = []
    const { traversal } = traverse({
      chain: dag.chain,
      timeout_ms: 30,
      fetch: async (hash, options) => {
        signals.push(options.signal)
        return await hanging_fetch(hash, options)
      }
    })
    traversal.enqueue([nth(dag.entries, 0).hash])
    await traversal.idle()
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(true)
    const options = { fetch: hanging_fetch, verify: () => { throw new Error('unused') }, is_landed: () => false, on_entry: () => {}, concurrency: 4, timers: SYSTEM_TIMERS }
    expect(() => create_traversal({ ...options, timeout_ms: Infinity })).toThrow('finite and positive')
  })

  test('§5.4.2 [MUST] a timed-out entry is recorded as unresolved', async () => {
    const dag = await linear_dag(1)
    const { hash } = nth(dag.entries, 0)
    const { traversal, verified } = traverse({ chain: dag.chain, timeout_ms: 30, fetch: hanging_fetch })
    traversal.enqueue([hash])
    await traversal.idle()
    expect(traversal.unresolved()).toEqual([hash])
    expect(verified).toEqual([])
    expect(traversal.outstanding()).toBe(1)
  })

  test('§5.4.2 [MUST] a timed-out entry does not block the traversal', async () => {
    const dag = await fan_in_dag(2)
    const stuck = nth(dag.branches, 0)
    const reachable = nth(dag.branches, 1)
    // One fetch slot: the stuck branch holds it until its timeout frees it.
    const { traversal, verified } = traverse({
      chain: dag.chain,
      concurrency: 1,
      timeout_ms: 30,
      fetch: async (hash, options) => hash === stuck.hash ? await hanging_fetch(hash, options) : dag.blocks.get(hash)
    })
    traversal.enqueue([stuck.hash, reachable.hash])
    await traversal.idle()
    expect(verified.map(({ hash }) => hash)).toEqual([reachable.hash])
    expect(traversal.unresolved()).toEqual([stuck.hash])
  })

  test('§5.4.2 [MUST] entries with unfetched ancestors are not merged', async () => {
    const dag = await linear_dag(3)
    const root = nth(dag.entries, 0)
    const middle = nth(dag.entries, 1)
    const tip = nth(dag.entries, 2)
    const target = create_oplog({ chain: dag.chain })
    const batches: string[][] = []
    const orchestrator = create_merge_orchestrator<VerifiedEntry>({
      is_landed: (hash) => target.entries.has(hash),
      merge: async (entries) => {
        batches.push(entries.map(({ hash }) => hash))
        merge_entries({ oplog: target, blocks: entries.map(({ bytes }) => bytes) })
      }
    })
    let root_reachable = false
    const { traversal, verified } = traverse({
      chain: dag.chain,
      timeout_ms: 30,
      fetch: async (hash, options) => hash === root.hash && !root_reachable ? await hanging_fetch(hash, options) : dag.blocks.get(hash)
    })
    traversal.enqueue([tip.hash])
    await traversal.idle()
    for (const entry of verified.splice(0)) orchestrator.add(entry)
    await orchestrator.settled()
    // The root never arrived, so neither descendant merges.
    expect(traversal.unresolved()).toEqual([root.hash])
    expect(batches).toEqual([])
    expect(target.entries.size).toBe(0)
    expect(orchestrator.pending()).toBe(2)
    // Once the root lands, the whole chain merges.
    root_reachable = true
    traversal.enqueue([root.hash])
    await traversal.idle()
    for (const entry of verified.splice(0)) orchestrator.add(entry)
    await orchestrator.settled()
    expect(batches.flat().sort()).toEqual([root.hash, middle.hash, tip.hash].sort())
    expect(target.entries.size).toBe(3)
  })

  test('§5.4.2 [MUST] resume re-enters at the earliest unresolved entry without re-fetching landed entries', async () => {
    const dag = await fan_in_dag(3)
    const first = nth(dag.branches, 0)
    const second = nth(dag.branches, 1)
    const third = nth(dag.branches, 2)
    const landed = new Set<string>()
    let reachable = false
    const { traversal, fetches } = traverse({
      chain: dag.chain,
      concurrency: 1,
      timeout_ms: 30,
      landed,
      fetch: async (hash, options) => reachable ? dag.blocks.get(hash) : await hanging_fetch(hash, options)
    })
    traversal.enqueue([first.hash, second.hash, third.hash])
    await traversal.idle()
    expect(traversal.unresolved()).toEqual([first.hash, second.hash, third.hash])
    traversal.pause()
    // The second branch lands by another route while paused.
    landed.add(second.hash)
    reachable = true
    fetches.length = 0
    traversal.resume()
    await traversal.idle()
    expect(fetches).toEqual([first.hash, third.hash])
    expect(traversal.unresolved()).toEqual([])
  })
})
