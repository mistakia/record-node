// Current-state resolution and merge (§4.4.2, §4.5), against src/oplog.

import { describe, expect, test } from 'bun:test'

import { assert_signed_entry_shape, hash_signed_entry } from '#entry/signed.ts'
import { build_del_operation } from '#entry/operations.ts'
import { generate_key_pair, type KeyPair } from '#identity/key-pair.ts'
import { resolve_current_state } from '#oplog/current-state.ts'
import { append_entry, create_oplog, get_live_entry, type Oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { append_track, blocks_of, oplog_state, open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'
import { build_race_entry, current_state_vector } from './vectors.ts'

const writers = [generate_key_pair(), generate_key_pair(), generate_key_pair()] as const
const [alice, bob, carol] = writers
const RACE = 'race-fingerprint'

const race_put = ({ key_pair, address, time, timestamp, n = 0 }: {
  key_pair: KeyPair
  address: string
  time: number
  timestamp: number
  n?: number
}) => sign_raw({
  private_key: key_pair.private_key,
  fields: { id: address, payload: track_put({ fingerprint: RACE, timestamp, content: { n } }), clock: { id: key_pair.public_key, time } }
})

const race_key = track_put({ fingerprint: RACE }).key

const fresh = (oplog: Oplog, ...batches: Uint8Array[][]) => {
  const replica = create_oplog({ chain: oplog.chain })
  for (const blocks of batches) merge_entries({ oplog: replica, blocks })
  return replica
}

describe('merge-ordering', () => {
  test('§4.4.2 [vector] F5 race set resolves to entry C', () => {
    const entries = current_state_vector.entries.map((vector) => {
      const hashed = hash_signed_entry(assert_signed_entry_shape(build_race_entry(vector)))
      expect(hashed.hash).toBe(vector.entry_hash)
      return { tag: vector.tag, hashed }
    })
    const winner_tag = (order: typeof entries) =>
      order.find(({ hashed }) => hashed === resolve_current_state(order.map(({ hashed }) => hashed)))?.tag
    expect(winner_tag(entries)).toBe(current_state_vector.winner)
    expect(winner_tag([...entries].reverse())).toBe(current_state_vector.winner)
    const [a, b, c] = entries
    if (a === undefined || b === undefined || c === undefined) throw new Error('vector has three entries')
    expect(winner_tag([c, a, b])).toBe(current_state_vector.winner)
  })

  test('§4.4.2 [MUST] clock.time orders first, then envelope timestamp, then entry hash', () => {
    const address = '/record/x/library'
    const later_clock = race_put({ key_pair: alice, address, time: 2, timestamp: 100 })
    const earlier_clock = race_put({ key_pair: alice, address, time: 1, timestamp: 999 })
    expect(resolve_current_state([earlier_clock, later_clock])).toBe(later_clock)
    const later_timestamp = race_put({ key_pair: bob, address, time: 2, timestamp: 200 })
    expect(resolve_current_state([later_clock, later_timestamp])).toBe(later_timestamp)
    const tie = race_put({ key_pair: carol, address, time: 2, timestamp: 200, n: 1 })
    const [lower] = [later_timestamp, tie].sort((x, y) => Buffer.compare(x.multihash, y.multihash))
    expect(resolve_current_state([later_timestamp, tie])).toBe(lower as typeof tie)
    expect(resolve_current_state([tie, later_timestamp])).toBe(lower as typeof tie)
  })

  test('§4.4.2 [MUST] peers holding the same signed entries agree on the order', async () => {
    const { oplog } = await open_test_library({ writers: [...writers] })
    const blocks = writers.flatMap((key_pair, index) => [
      race_put({ key_pair, address: oplog.chain.address, time: 3, timestamp: 50, n: index }).bytes,
      race_put({ key_pair, address: oplog.chain.address, time: 1 + index, timestamp: 70, n: 10 + index }).bytes
    ])
    const forward = fresh(oplog, blocks)
    const backward = fresh(oplog, [...blocks].reverse())
    expect(forward.current.get(race_key)?.hash).toBe(backward.current.get(race_key)?.hash as string)
    expect(oplog_state(forward)).toEqual(oplog_state(backward))
  })

  test('§4.4.2 [MUST] the hash tiebreak compares raw multihash bytes, not base58btc strings', () => {
    const address = '/record/x/library'
    const first = race_put({ key_pair: alice, address, time: 4, timestamp: 4, n: 1 })
    const second = race_put({ key_pair: bob, address, time: 4, timestamp: 4, n: 2 })
    const winner = resolve_current_state([first, second])
    // Relabel the hash strings so string order runs opposite to byte order.
    const relabel = (entry: typeof first, hash: string) => ({ ...entry, hash })
    const relabelled = winner === first
      ? [relabel(first, 'zz'), relabel(second, 'z1')]
      : [relabel(first, 'z1'), relabel(second, 'zz')]
    expect(resolve_current_state(relabelled)?.multihash).toBe(winner?.multihash as Uint8Array)
  })

  test('§4.4.2 [check] a DEL that sorts first tombstones the PUT with the same key', async () => {
    const { oplog } = await open_test_library({ writers: [alice] })
    const put = append_track({ oplog, key_pair: alice, fingerprint: RACE })
    expect(get_live_entry({ oplog, key: race_key })).toBe(put)
    const del = append_entry({ oplog, key_pair: alice, payload: build_del_operation({ key: race_key, type: 'track' }) })
    expect(oplog.current.get(race_key)).toBe(del)
    expect(get_live_entry({ oplog, key: race_key })).toBeUndefined()
  })

  test('§4.4.2 [MUST] PUT and DEL effects apply only to the current entry', async () => {
    const { oplog } = await open_test_library({ writers: [alice, bob] })
    const newer = race_put({ key_pair: alice, address: oplog.chain.address, time: 5, timestamp: 5, n: 1 })
    const older_put = race_put({ key_pair: bob, address: oplog.chain.address, time: 2, timestamp: 9, n: 2 })
    const older_del = sign_raw({
      private_key: bob.private_key,
      fields: { id: oplog.chain.address, payload: build_del_operation({ key: race_key, type: 'track', timestamp: 9 }), clock: { id: bob.public_key, time: 3 } }
    })
    merge_entries({ oplog, blocks: [newer.bytes, older_put.bytes, older_del.bytes] })
    expect(oplog.entries.size).toBe(3)
    expect(get_live_entry({ oplog, key: race_key })?.hash).toBe(newer.hash)
  })

  test('§4.4.2 [MUST] recomputing on merge uses every known entry for the key', async () => {
    const { oplog } = await open_test_library({ writers: [alice, bob] })
    const high = race_put({ key_pair: alice, address: oplog.chain.address, time: 9, timestamp: 1 })
    const low = race_put({ key_pair: bob, address: oplog.chain.address, time: 3, timestamp: 1 })
    merge_entries({ oplog, blocks: [high.bytes] })
    merge_entries({ oplog, blocks: [low.bytes] })
    // Resolving over the newly arrived entry alone would pick low.
    expect(oplog.current.get(race_key)?.hash).toBe(high.hash)
  })

  test('§4.5 [MUST] an entry failing verification is dropped and absent from the merged state', async () => {
    const { oplog } = await open_test_library({ writers: [alice] })
    const good = race_put({ key_pair: alice, address: oplog.chain.address, time: 1, timestamp: 1 })
    const forged = race_put({ key_pair: bob, address: oplog.chain.address, time: 9, timestamp: 9 })
    const { merged, rejected } = merge_entries({ oplog, blocks: [forged.bytes, good.bytes] })
    expect(merged.map(({ hash }) => hash)).toEqual([good.hash])
    expect(rejected.length).toBe(1)
    expect([...oplog.entries.keys()]).toEqual([good.hash])
    expect([...oplog.heads]).toEqual([good.hash])
    expect(oplog.current.get(race_key)?.hash).toBe(good.hash)
    expect(oplog.clock_time).toBe(1)
  })

  test('§4.5 [MUST] inserting an entry whose hash already exists is a no-op', async () => {
    const { oplog } = await open_test_library({ writers: [alice] })
    const entry = race_put({ key_pair: alice, address: oplog.chain.address, time: 1, timestamp: 1 })
    expect(merge_entries({ oplog, blocks: [entry.bytes, entry.bytes] }).merged.length).toBe(1)
    const before = oplog_state(oplog)
    expect(merge_entries({ oplog, blocks: [entry.bytes] }).merged).toEqual([])
    expect(oplog_state(oplog)).toEqual(before)
  })

  test('§4.5 [MUST] merge is associative and commutative: merge(merge(A,B),C) equals merge(A,merge(B,C)) and merge(C,merge(B,A))', async () => {
    const { oplog } = await open_test_library({ writers: [...writers] })
    // Each writer appends on its own replica: a shared key, its own key, and a DEL.
    const [a, b, c] = writers.map((key_pair, index) => {
      const replica = create_oplog({ chain: oplog.chain })
      append_track({ oplog: replica, key_pair, fingerprint: RACE, timestamp: 100 + index, content: { index } })
      append_track({ oplog: replica, key_pair, fingerprint: `own-${index}`, timestamp: 100 })
      if (index === 1) append_entry({ oplog: replica, key_pair, payload: build_del_operation({ key: race_key, type: 'track' }) })
      return blocks_of(replica)
    }) as [Uint8Array[], Uint8Array[], Uint8Array[]]
    const ab_c = fresh(oplog, blocks_of(fresh(oplog, a, b)), c)
    const a_bc = fresh(oplog, a, blocks_of(fresh(oplog, b, c)))
    const c_ba = fresh(oplog, c, blocks_of(fresh(oplog, b, a)))
    expect(oplog_state(ab_c)).toEqual(oplog_state(a_bc))
    expect(oplog_state(ab_c)).toEqual(oplog_state(c_ba))
    expect(ab_c.entries.size).toBe(7)
    expect(ab_c.heads.size).toBe(3)
  })

  test('§4.5 [MUST] concurrent merge batches end in the same query-index state as one merge over their union', async () => {
    const { oplog } = await open_test_library({ writers: [...writers] })
    const blocks = writers.flatMap((key_pair, index) => [1, 2, 3].map((time) =>
      race_put({ key_pair, address: oplog.chain.address, time: time + index, timestamp: 10 * time, n: index * 10 + time }).bytes))
    const batched = fresh(oplog, blocks.slice(0, 4), blocks.slice(4))
    const union = fresh(oplog, [...blocks].reverse())
    expect([...batched.current].map(([key, { hash }]) => [key, hash])).toEqual([...union.current].map(([key, { hash }]) => [key, hash]))
  })
})
