// Label records and per-pair current state (§2.5, §4.4.2), against src/entry
// and src/oplog, through the F12 vector: each entry is rebuilt with
// record-node's own signing and merged into the F3 library.

import { describe, expect, test } from 'bun:test'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { build_labels_put, is_labels_put } from '#entry/operations.ts'
import { label_state_key } from '#entry/records.ts'
import type { HashedEntry } from '#entry/signed.ts'
import { create_oplog, type Oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import type { LabelPair } from '#types/entry.ts'
import { sign_raw, TEST_PRIVATE_KEY } from '#test/helpers/library.ts'
import { create_memory_block_store } from '#test/helpers/memory-block-store.ts'
import { shuffled } from '#test/query-db/fixtures.ts'
import { ac_chain_vector, label_vector, TEST_PUBKEY_HEX } from './vectors.ts'

const open_library = async (): Promise<Oplog> => {
  const block_store = create_memory_block_store()
  const { address } = await create_ac_chain({ name: 'library', type: 'recordstore', write_keys: [TEST_PUBKEY_HEX], block_store })
  expect(address).toBe(ac_chain_vector.library_address)
  return create_oplog({ chain: await resolve_ac_chain({ library_address: address, block_store }) })
}

// Each entry cites the entries the vector names, with the §4.2 clock.
const build_entries = (): Map<string, HashedEntry> => {
  const built = new Map<string, HashedEntry>()
  for (const vector of label_vector.entries) {
    const next = vector.next.map((name) => built.get(name) as HashedEntry)
    const payload = 'record' in vector
      ? build_labels_put({ set: vector.record.set, unset: vector.record.unset, timestamp: vector.record.timestamp })
      : { op: 'DEL', key: vector.del.key, value: { type: 'track', timestamp: vector.del.timestamp } }
    const time = next.length === 0 ? 1 : Math.max(...next.map(({ entry }) => entry.clock.time)) + 1
    built.set(vector.name, sign_raw({
      private_key: TEST_PRIVATE_KEY,
      fields: { id: ac_chain_vector.library_address, payload, next: next.map(({ hash }) => hash), clock: { id: TEST_PUBKEY_HEX, time } }
    }))
  }
  return built
}

// A pair applies when the record current for it names it in set (§2.5).
const applied = (oplog: Oplog, pair: LabelPair): boolean => {
  const current = oplog.current.get(label_state_key(pair))?.operation
  return current !== undefined && is_labels_put(current) && current.value.set.some(([track_id, label]) => track_id === pair[0] && label === pair[1])
}

const label_state = (oplog: Oplog) =>
  label_vector.label_state.map(({ track_id, label }) => ({ track_id, label, applied: applied(oplog, [track_id, label]) }))

const expected_state = label_vector.label_state.map((pair) => ({ ...pair }))

describe('label-vector', () => {
  const built = build_entries()

  test('§2.5 [vector] F12 each label record key is the sha256 of its dag-cbor value, and each entry hashes to the spec value', () => {
    for (const vector of label_vector.entries) {
      const hashed = built.get(vector.name) as HashedEntry
      expect(hashed.hash).toBe(vector.entry_hash)
      if ('record' in vector) expect((hashed.entry.payload as { key: string }).key).toBe(vector.key)
    }
  })

  test('§4.4.2 [vector] F12 label state resolves per pair, and the entry.hash tiebreak decides a tied pair', async () => {
    const oplog = await open_library()
    const { merged, rejected } = merge_entries({ oplog, blocks: [...built.values()].map(({ bytes }) => bytes) })
    expect(rejected).toEqual([])
    expect(merged.length).toBe(label_vector.entries.length)
    expect(label_state(oplog)).toEqual(expected_state)
    const tied = label_state_key([label_vector.track_b, 'y'])
    expect(oplog.current.get(tied)?.hash).toBe(built.get(label_vector.tie_winner)?.hash as string)
  })

  test('§2.5 [vector] F12 labels outlive a DEL of their track, and apply to a track no library holds', async () => {
    const oplog = await open_library()
    merge_entries({ oplog, blocks: [...built.values()].map(({ bytes }) => bytes) })
    expect(oplog.current.get(label_vector.track_a)?.operation).toMatchObject({ op: 'DEL' })
    expect(applied(oplog, [label_vector.track_a, 'lifestream-radio'])).toBe(true)
    expect(oplog.key_entries.has(label_vector.track_b)).toBe(false)
    expect(applied(oplog, [label_vector.track_b, 'mix/x'])).toBe(true)
  })

  test('§4.5 [MUST] F12 label state does not depend on the order entries arrive in', async () => {
    const clock_of = (hashed: HashedEntry) => hashed.entry.clock.time
    for (const seed of [1, 7, 42]) {
      const oplog = await open_library()
      // An entry merges only once its next have, so batches follow the clock.
      for (const hashed of shuffled([...built.values()], seed).sort((a, b) => clock_of(a) - clock_of(b))) {
        merge_entries({ oplog, blocks: [hashed.bytes] })
      }
      expect(label_state(oplog)).toEqual(expected_state)
    }
  })
})
