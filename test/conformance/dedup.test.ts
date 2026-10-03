// Deduplication guarantees (§2.10), against src/entry and src/oplog. The
// §2.10 content.hash stability wording is pending an operator ruling, and the
// fingerprint-stability stub needs fpcalc; both stay pending.

import { describe, expect, test } from 'bun:test'

import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { append_track, oplog_state, open_test_library, track_put } from '#test/helpers/library.ts'
import { ProtocolError } from '#types/errors.ts'

const writer = generate_key_pair()
const FINGERPRINT = 'AQADtEmSaImSJI'

const library = async () => (await open_test_library({ writers: [writer] })).oplog

describe('dedup', () => {
  test('§2.10 [MUST] tracks with the same sha256(fingerprint) are the same track', async () => {
    const oplog = await library()
    expect(track_put({ fingerprint: FINGERPRINT }).key).toBe(compute_track_id(FINGERPRINT))
    append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, content: { source: 'flac' } })
    const second = append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, content: { source: 'mp3' } })
    expect(oplog.key_entries.size).toBe(1)
    expect(get_live_entry({ oplog, key: compute_track_id(FINGERPRINT) })).toBe(second)
  })

  test.todo('§2.10 [MUST] the fingerprint is the same regardless of tags, artwork, or container framing', () => {})
  test.todo('§2.10 [MUST] tag-stripped blobs are byte-identical for the same source audio, so content.hash is stable across peers (wording pending operator ruling)', () => {})

  test('§2.10 [MUST] duplicate_key treats a missing tags field as []', async () => {
    const oplog = await library()
    append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT })
    expect(() => append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, tags: [] })).toThrow('duplicates live entry')
  })

  test('§2.10 [MUST] duplicate_key sorts tags lexicographically before comparison', async () => {
    const oplog = await library()
    append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, tags: ['a', 'b'] })
    expect(() => append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, tags: ['b', 'a'] })).toThrow('duplicates live entry')
    // Re-labelling is a new entry over the same content CID (§6.6).
    expect(() => append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, tags: ['a', 'c'] })).not.toThrow()
  })

  test('§2.10 [MUST] a rejected duplicate PUT is not appended to the oplog', async () => {
    const oplog = await library()
    append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, timestamp: 1 })
    const before = oplog_state(oplog)
    expect(() => append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT, timestamp: 2 })).toThrow(ProtocolError)
    expect(oplog_state(oplog)).toEqual(before)
  })

  test('§2.10 [check] a PUT whose duplicate_key equals a live entry is rejected with an identifiable error', async () => {
    const oplog = await library()
    append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT })
    let caught: unknown
    try {
      append_track({ oplog, key_pair: writer, fingerprint: FINGERPRINT })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ProtocolError)
    expect((caught as ProtocolError).code).toBe('duplicate_entry')
  })
})
