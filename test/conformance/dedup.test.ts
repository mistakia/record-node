// Deduplication guarantees (§2.10), against src/entry and src/oplog, and
// against src/ingest with fpcalc and ffmpeg for fingerprint and content.hash
// stability.

import { describe, expect, test } from 'bun:test'

import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { compute_fingerprint } from '#ingest/fingerprint.ts'
import { ingest_local_file } from '#ingest/pipeline-local.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { open_offline_helia_store } from '#test/helpers/helia.ts'
import { make_tagged_copy, open_ingest_target, scratch_dir, stored_content, toolchain } from '#test/helpers/ingest.ts'
import { append_track, oplog_state, open_test_library, track_put } from '#test/helpers/library.ts'
import { ProtocolError } from '#types/errors.ts'
import { audio_pipeline_vector as f7 } from './vectors.ts'

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

  test('§2.10 [MUST] the fingerprint is the same regardless of tags, artwork, or container framing', async () => {
    const dir = scratch_dir()
    const variants = [
      f7.fixture_path,
      await make_tagged_copy({ dir, title: 'A', covers: ['red'] }),
      await make_tagged_copy({ dir, title: 'B', covers: ['green', 'blue'] })
    ]
    for (const file_path of variants) expect(await compute_fingerprint({ file_path, toolchain })).toBe(f7.fingerprint)
  })

  // Two peers on different store backends, one fed a tagged copy with artwork.
  test('§2.10 [MUST] tag-stripped blobs are byte-identical for the same source audio, so content.hash is stable across peers', async () => {
    const tagged = await make_tagged_copy({ dir: scratch_dir(), covers: ['red'] })
    const memory_peer = await open_ingest_target()
    const { helia, content_store } = await open_offline_helia_store()
    try {
      const helia_peer = { ...(await open_ingest_target()), content_store }
      const hashes = []
      for (const [target, file_path] of [[memory_peer, f7.fixture_path], [helia_peer, tagged]] as const) {
        const { content_cid } = await ingest_local_file({ file_path, target, toolchain })
        hashes.push((await stored_content({ target, cid: content_cid })).hash)
      }
      expect(hashes).toEqual([f7.audio_cid, f7.audio_cid])
    } finally {
      await helia.stop()
    }
  })

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
