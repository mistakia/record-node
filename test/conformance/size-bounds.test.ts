// Size bounds at deserialization (§2.8.3), against src/encoding, src/entry,
// and src/oplog.

import { describe, expect, test } from 'bun:test'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { assert_label, assert_signed_entry_size, SIGNED_ENTRY_MAX_BYTES } from '#encoding/size-bounds.ts'
import { record_key } from '#access-control/capability-record.ts'
import { decode_payload } from '#entry/payload.ts'
import { decode_signed_entry } from '#entry/signed.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { merge_entries } from '#oplog/merge.ts'
import { open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'
import { track_envelope_vector as track_vector } from './vectors.ts'

const writer = generate_key_pair()
const labels_put = (label: string) => {
  const value = { type: 'labels', v: 1, timestamp: 1, set: [[track_vector.id, label]], unset: [] }
  return { op: 'PUT', key: record_key(value), value }
}

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
    expect(merge_entries({ oplog, blocks: [oversized.bytes] }).rejected.map(({ error }) => error.code)).toEqual(['size_exceeded'])
  })

  test('§2.8.3 [MUST] an envelope payload over 1 MiB of dag-cbor is rejected', () => {
    expect(() => decode_payload(encode_canonical({ blob: 'x'.repeat(1024 * 1024 - 64) }))).not.toThrow()
    expect(() => decode_payload(encode_canonical({ blob: 'x'.repeat(1024 * 1024) }))).toThrow('envelope payload is')
  })

  test('§2.8.3 [MUST] a label over 128 UTF-8 bytes is rejected', () => {
    expect(() => assert_label('a'.repeat(128))).not.toThrow()
    // 65 characters, 130 UTF-8 bytes: the bound counts bytes, not characters.
    expect(() => assert_label('é'.repeat(65))).toThrow('label is 130 bytes')
  })

  test('§2.8.3 [MUST] a label record has no count bound of its own: the entry bound limits it', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const pairs = (count: number) => Array.from({ length: count }, (_, index) => [track_vector.id, `label-${index}`])
    const record = (count: number) => {
      const value = { type: 'labels', v: 1, timestamp: 1, set: pairs(count), unset: [] }
      return sign_raw({ private_key: writer.private_key, fields: { id: oplog.chain.address, payload: { op: 'PUT', key: record_key(value), value }, clock: { id: writer.public_key, time: 1 } } })
    }
    expect(merge_entries({ oplog, blocks: [record(1000).bytes] }).merged.length).toBe(1)
    expect(merge_entries({ oplog, blocks: [record(4000).bytes] }).rejected.map(({ error }) => error.code)).toEqual(['size_exceeded'])
  })

  test('§2.8.3 [MUST] oversized entries and payloads are dropped at verification time, before signature checks', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const oversized = sign_raw({ private_key: writer.private_key, fields: oversized_fields(oplog.chain.address) })
    const unsigned_oversized = encode_canonical({ ...oversized.entry, sig: '00' })
    const long_label = sign_raw({
      private_key: writer.private_key,
      fields: { id: oplog.chain.address, payload: labels_put('x'.repeat(129)), clock: { id: writer.public_key, time: 1 } }
    })
    const bad_signature_label = encode_canonical({ ...long_label.entry, sig: '00' })
    const { rejected } = merge_entries({ oplog, blocks: [unsigned_oversized, bad_signature_label] })
    // Size, not signature, is the reason even though both signatures are invalid.
    expect(rejected.map(({ error }) => error.code)).toEqual(['size_exceeded', 'size_exceeded'])
  })
})
