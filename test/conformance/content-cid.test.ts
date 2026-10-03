// Content addressing (§2.1, §2.2.1, §2.3.1), against src/encoding and src/entry.

import { describe, expect, test } from 'bun:test'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { base32 } from 'multiformats/bases/base32'

import { decode_canonical, encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid, compute_cid_string, parse_cid, SHA3_512_CODE } from '#encoding/cid.ts'
import { decode_signed_entry } from '#entry/signed.ts'
import { validate_about_content, validate_log_content, validate_track_content } from '#entry/payload.ts'
import { ProtocolError } from '#types/errors.ts'
import { sign_raw, TEST_PRIVATE_KEY } from '#test/helpers/library.ts'
import { content_cid_vector, envelope_vectors, signing_vector } from './vectors.ts'

const DAG_CBOR_CODE = 0x71

// The F0 map opens with "v": 2 (61 76 02) then "id" (62 69 64, 78 <len>, bytes).
const swap_first_two_entries = (bytes: Uint8Array) => {
  const id_end = 9 + (bytes[8] ?? 0)
  return Uint8Array.from([bytes[0] ?? 0, ...bytes.slice(4, id_end), ...bytes.slice(1, 4), ...bytes.slice(id_end)])
}

const error_code = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as ProtocolError).code
  }
  return undefined
}

describe('content-cid', () => {
  test('§2.1 [MUST] envelope payloads are stored as dag-cbor objects hashed with sha3-512', () => {
    for (const vector of envelope_vectors) {
      const cid = compute_cid(encode_canonical(vector.payload))
      expect(cid.code).toBe(DAG_CBOR_CODE)
      expect(cid.multihash.code).toBe(SHA3_512_CODE)
      expect(cid.multihash.size).toBe(64)
    }
  })

  test('§2.1 [MUST] content CID is dag-cbor, then sha3-512, then CIDv1 with dag-cbor codec, then base58btc', () => {
    const cid_string = compute_cid_string(encode_canonical(content_cid_vector.payload))
    expect(cid_string.startsWith('z')).toBe(true)
    expect(parse_cid(cid_string).version).toBe(1)
    const cid = compute_cid(encode_canonical(content_cid_vector.payload))
    expect(() => parse_cid(cid.toString(base32))).toThrow(ProtocolError)
    // A sha2-256 CID, as legacy libraries carry, is not a §2.1 content CID.
    expect(() => parse_cid('zdpuAqyy2yLfTpevS4pxfVadSmS14oRNAXMvnAYet9zKwSqZc')).toThrow('not a dag-cbor sha3-512 CIDv1')
  })

  test('§2.1 [MUST] readers reject non-canonical dag-cbor input instead of re-encoding it', () => {
    // {"b": 1, "a": 2} with keys out of canonical order.
    const unordered_map = hexToBytes('a2616201616102')
    expect(error_code(() => decode_canonical(unordered_map))).toBe('non_canonical_encoding')
    // The F0 signed entry with its first two map entries swapped: every byte
    // present, keys out of canonical order.
    const signed = sign_raw({ private_key: TEST_PRIVATE_KEY, fields: signing_vector.unsigned_entry })
    const reordered = swap_first_two_entries(signed.bytes)
    expect(reordered.length).toBe(signed.bytes.length)
    expect(error_code(() => decode_signed_entry(reordered))).toBe('non_canonical_encoding')
  })

  test('§2.3.1 [MUST] {"hello":"world"} encodes to a16568656c6c6f65776f726c64 and yields CID zBwWX8pQhjGa…', () => {
    const bytes = encode_canonical(content_cid_vector.payload)
    expect(bytesToHex(bytes)).toBe(content_cid_vector.cbor_hex)
    expect(compute_cid_string(bytes)).toBe(content_cid_vector.cid)
  })

  test('§2.2.1 [vector] F2 track, log, and about payloads yield the spec content CIDs', () => {
    for (const vector of envelope_vectors) {
      const bytes = encode_canonical(vector.payload)
      expect(bytes.length).toBe(vector.payload_cbor_length)
      expect(compute_cid_string(bytes)).toBe(vector.content)
    }
    const [track, log, about] = envelope_vectors
    expect(() => validate_track_content(track.payload)).not.toThrow()
    expect(() => validate_log_content(log.payload)).not.toThrow()
    expect(() => validate_about_content({ value: about.payload, library_address: about.id_input })).not.toThrow()
  })
})
