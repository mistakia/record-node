// Bounded fetch traversal (§5.4.2).
// The fan-out cap is part of entry verification and runs against src/entry
// and src/oplog; the traversal itself lands with the replication stage.

import { describe, expect, test } from 'bun:test'

import { build_unsigned_entry, MAX_ENTRY_POINTERS } from '#entry/build.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { merge_entries } from '#oplog/merge.ts'
import { content_cid_of, open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'

const writer = generate_key_pair()
const hashes = (count: number) => Array.from({ length: count }, (_, index) => content_cid_of({ index }))

describe('traversal-bounds', () => {
  test.todo('§5.4.2 [MUST] traversal tracks the set of enqueued entry hashes', () => {})
  test.todo('§5.4.2 [MUST] an already-enqueued entry is never re-enqueued, so a cycle terminates', () => {})
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
  test.todo('§5.4.2 [MUST] a rejected fan-out entry enqueues none of its children', () => {})
  test.todo('§5.4.2 [MUST] in-flight fetches per library are bounded by a finite limit', () => {})
  test.todo('§5.4.2 [MUST] each fetch has a finite timeout', () => {})
  test.todo('§5.4.2 [MUST] a timed-out entry is recorded as unresolved', () => {})
  test.todo('§5.4.2 [MUST] a timed-out entry does not block the traversal', () => {})
  test.todo('§5.4.2 [MUST] entries with unfetched ancestors are not merged', () => {})
  test.todo('§5.4.2 [MUST] resume re-enters at the earliest unresolved entry without re-fetching landed entries', () => {})
})
