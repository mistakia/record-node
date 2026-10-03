// Fingerprinting, tag stripping, metadata, ingest, and listens (§6).
// Track-id and listens rules run against src/entry and src/oplog; everything
// that needs fpcalc, ffmpeg, metadata extraction, or ingest stays pending.

import { describe, expect, test } from 'bun:test'

import { build_del_operation } from '#entry/operations.ts'
import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_entry } from '#oplog/dag.ts'
import { append_listen } from '#oplog/listens.ts'
import { open_test_library } from '#test/helpers/library.ts'

const writer = generate_key_pair()
const TRACK_ID = compute_track_id('AQADtEmSaImS')

describe('content-processing', () => {
  test.todo('§6.1.1 [MUST] fingerprints come from Chromaprint', () => {})
  test.todo('§6.1.2 [MUST] Chromaprint algorithm 2 is used', () => {})
  test.todo('§6.1.2 [MUST] no fingerprint-affecting parameter is overridden; only the binary path is configurable', () => {})
  test.todo('§6.1.2 [MUST] algorithm 2 is requested explicitly, whatever the tool default', () => {})
  test.todo('§6.1.2.1 [MUST] the fingerprint is identical regardless of tags, artwork, or container framing', () => {})
  test.todo('§6.1.2.1 [MUST] files with the same samples and different tags yield the same fingerprint and track id', () => {})
  test.todo('§6.1.2.1 [MUST] tag-stripped audio is never fed to the fingerprinter', () => {})
  test.todo('§6.1.3 [MUST] the fingerprint is the fpcalc string output', () => {})
  test.todo('§6.1.5 [MUST] sha256(fpcalc(tagged)) equals sha256(fpcalc(strip_tags(tagged)))', () => {})
  test.todo('§6.2.1 [MUST] the tag-stripped copy is what gets uploaded', () => {})
  test.todo('§6.2.1 [MUST] tag stripping is deterministic, lossless, and byte-preserving', () => {})
  test.todo('§6.2.2 [MUST] tag stripping copies audio streams only', () => {})
  test.todo('§6.2.2 [MUST] tag stripping preserves audio bytes exactly', () => {})
  test.todo('§6.2.2 [MUST] tag stripping removes all metadata', () => {})
  test.todo('§6.2.2 [MUST] tag stripping suppresses the encoder-version tag', () => {})
  test.todo('§6.3.1 [MUST] content.tags carries acoustid_fingerprint', () => {})
  test.todo('§6.3.2 [MUST] missing format fields are omitted or null, never coerced to 0', () => {})
  test.todo('§6.3.3 [MUST] each artwork element is a CID', () => {})
  test.todo('§6.3.3 [MUST] a file with no artwork yields an empty artwork array', () => {})
  test.todo('§6.3.4 [MUST] artwork is not embedded in the tag-stripped audio', () => {})
  test.todo('§6.4.1 [MUST] ingest is rejected on an empty fingerprint, fingerprinter error, or no decodable audio', () => {})
  test('§6.4.1 [MUST] sha256("") is never used as a fallback track id', () => {
    expect(() => compute_track_id('')).toThrow('an empty fingerprint has no track id')
  })
  test.todo('§6.4.1 [MUST] ingest is rejected when duration is 0 or unknown or the decoded sample count is zero', () => {})
  test.todo('§6.4.2 [MUST] the resolver url field is stripped before persistence', () => {})
  test.todo('§6.4.3 [MUST] CID ingest validates the §2.4.1 required fields before accepting', () => {})
  test('§6.5 [MUST] a listen write without trackId is rejected', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    expect(() => append_listen({ oplog, track_id: '', address: oplog.chain.address, key_pair: writer })).toThrow('requires trackId')
    const listen = append_listen({ oplog, track_id: TRACK_ID, address: oplog.chain.address, key_pair: writer, timestamp: 1 })
    expect(listen.operation).toEqual({ trackId: TRACK_ID, address: oplog.chain.address, timestamp: 1 })
  })

  test('§6.5 [MUST] listen entries cannot be deleted', async () => {
    const { oplog } = await open_test_library({ type: 'listens', writers: [writer] })
    append_listen({ oplog, track_id: TRACK_ID, address: oplog.chain.address, key_pair: writer })
    expect(() => append_entry({ oplog, key_pair: writer, payload: build_del_operation({ key: TRACK_ID, type: 'track' }) }))
      .toThrow('accepts only listen writes')
    expect(oplog.entries.size).toBe(1)
  })
})
