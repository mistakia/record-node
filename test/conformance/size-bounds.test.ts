// Size bounds at deserialization (§2.8.3), against src/encoding, src/entry,
// and src/oplog.

import { describe, expect, test } from 'bun:test'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import {
  assert_envelope_tags,
  assert_signed_entry_size,
  ENVELOPE_TAGS_MAX_COUNT,
  SIGNED_ENTRY_MAX_BYTES
} from '#encoding/size-bounds.ts'
import { validate_envelope } from '#entry/envelope.ts'
import { decode_payload } from '#entry/payload.ts'
import { decode_signed_entry } from '#entry/signed.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { merge_entries } from '#oplog/merge.ts'
import { open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'
import { envelope_vectors } from './vectors.ts'

const writer = generate_key_pair()
const [track_vector] = envelope_vectors
const envelope = (tags: unknown) =>
  ({ id: track_vector.id, timestamp: 1, v: 1, type: 'track', content: track_vector.content, tags })

// A PUT whose envelope carries an unknown extra big enough to push the
// signed entry past 256 KiB.
const oversized_fields = (address: string) => {
  const { value } = track_put()
  return {
    id: address,
    payload: { op: 'PUT', key: value.id, value: { ...value, padding: 'x'.repeat(SIGNED_ENTRY_MAX_BYTES) } },
    clock: { id: writer.public_key, time: 1 }
  }
}

describe('size-bounds', () => {
  test('§2.8.3 [MUST] a signed entry over 256 KiB of dag-cbor is rejected', async () => {
    expect(() => assert_signed_entry_size(new Uint8Array(SIGNED_ENTRY_MAX_BYTES))).not.toThrow()
    expect(() => assert_signed_entry_size(new Uint8Array(SIGNED_ENTRY_MAX_BYTES + 1))).toThrow('over the 262144-byte bound')
    const { oplog } = await open_test_library({ writers: [writer] })
    const oversized = sign_raw({ private_key: writer.private_key, fields: oversized_fields(oplog.chain.address) })
    expect(() => decode_signed_entry(oversized.bytes)).toThrow('signed entry is')
    expect(merge_entries({ oplog, blocks: [oversized.bytes] }).rejected.map(({ code }) => code)).toEqual(['size_exceeded'])
  })

  test('§2.8.3 [MUST] an envelope payload over 1 MiB of dag-cbor is rejected', () => {
    expect(() => decode_payload(encode_canonical({ blob: 'x'.repeat(1024 * 1024 - 64) }))).not.toThrow()
    expect(() => decode_payload(encode_canonical({ blob: 'x'.repeat(1024 * 1024) }))).toThrow('envelope payload is')
  })

  test('§2.8.3 [MUST] a track envelope with more than 256 tags is rejected', () => {
    const tags = (count: number) => Array.from({ length: count }, (_, index) => `t${index}`)
    expect(() => validate_envelope(envelope(tags(ENVELOPE_TAGS_MAX_COUNT)))).not.toThrow()
    expect(() => validate_envelope(envelope(tags(ENVELOPE_TAGS_MAX_COUNT + 1)))).toThrow('257 envelope tags')
  })

  test('§2.8.3 [MUST] a tag over 128 UTF-8 bytes is rejected', () => {
    expect(() => assert_envelope_tags(['a'.repeat(128)])).not.toThrow()
    // 65 characters, 130 UTF-8 bytes: the bound counts bytes, not characters.
    expect(() => assert_envelope_tags(['é'.repeat(65)])).toThrow('envelope tag is 130 bytes')
  })

  test('§2.8.3 [MUST] a tags array serialising over 8 KiB is rejected', () => {
    const tags = Array.from({ length: 80 }, (_, index) => `${index}`.padEnd(120, 'x'))
    expect(encode_canonical(tags).length).toBeGreaterThan(8 * 1024)
    expect(() => assert_envelope_tags(tags)).toThrow('envelope tags is')
  })

  test('§2.8.3 [MUST] oversized entries and payloads are dropped at verification time, before signature checks', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const oversized = sign_raw({ private_key: writer.private_key, fields: oversized_fields(oplog.chain.address) })
    const unsigned_oversized = encode_canonical({ ...oversized.entry, sig: '00' })
    const many_tags = sign_raw({
      private_key: writer.private_key,
      fields: {
        id: oplog.chain.address,
        payload: { op: 'PUT', key: track_vector.id, value: envelope(Array.from({ length: 300 }, (_, index) => `${index}`)) },
        clock: { id: writer.public_key, time: 1 }
      }
    })
    const bad_signature_tags = encode_canonical({ ...many_tags.entry, sig: '00' })
    const { rejected } = merge_entries({ oplog, blocks: [unsigned_oversized, bad_signature_tags] })
    // Size, not signature, is the reason even though both signatures are invalid.
    expect(rejected.map(({ code }) => code)).toEqual(['size_exceeded', 'size_exceeded'])
  })
})
