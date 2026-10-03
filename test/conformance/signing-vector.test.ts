// Entry signing and entry hash (§3.4, §4.1), against src/identity and src/entry.

import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { build_unsigned_entry } from '#entry/build.ts'
import { decode_signed_entry, hash_signed_entry } from '#entry/signed.ts'
import { key_pair_from_private_key, validate_compressed_pubkey } from '#identity/key-pair.ts'
import { sign_entry, signing_digest } from '#identity/signing.ts'
import { verify_entry_signature } from '#identity/verification.ts'
import { TEST_PRIVATE_KEY } from '#test/helpers/library.ts'
import { child_entry_vector, signed_entry_vector, signing_vector, TEST_PUBKEY_HEX } from './vectors.ts'

const vector_unsigned = ({ id, payload, next, refs, clock }: {
  id: string
  payload: unknown
  next: readonly string[]
  refs: readonly string[]
  clock: { id: string, time: number }
}) => build_unsigned_entry({ id, payload, next, refs, clock: { id: validate_compressed_pubkey(clock.id), time: clock.time } })

const f0_unsigned = vector_unsigned(signing_vector.unsigned_entry)
const f0_signed = sign_entry({ unsigned_entry: f0_unsigned, private_key: TEST_PRIVATE_KEY })

describe('signing-vector', () => {
  test('§3.4.1 [MUST] the unsigned entry has no hash field', () => {
    expect(() => build_unsigned_entry({ ...f0_unsigned, hash: 'zBwWX' } as never)).toThrow('must not carry hash')
    expect(Object.keys(f0_unsigned)).not.toContain('hash')
    // A stray hash on the signing input never reaches the signed bytes.
    const with_stray_hash = { ...f0_unsigned, hash: signed_entry_vector.entry_hash }
    expect(bytesToHex(signing_digest(with_stray_hash))).toBe(signing_vector.sha256_digest_hex)
    expect(Object.keys(f0_signed)).not.toContain('hash')
  })

  test('§3.4.2 [MUST] the signing input is the dag-cbor encoding of the unsigned entry', () => {
    expect(bytesToHex(encode_canonical(f0_unsigned))).toBe(signing_vector.unsigned_cbor_hex)
    expect(bytesToHex(signing_digest(f0_unsigned))).toBe(signing_vector.sha256_digest_hex)
  })

  test('§3.4.2 [MUST] identical entry objects encode to byte-identical dag-cbor', () => {
    const { id, payload, next, refs, v, clock } = f0_unsigned
    const reordered = { clock, v, refs, next, payload, id }
    expect(bytesToHex(encode_canonical(reordered))).toBe(bytesToHex(encode_canonical(f0_unsigned)))
  })

  test('§3.4.4 [MUST] signatures are ECDSA over secp256k1 on the SHA-256 digest, DER-encoded', () => {
    const der = hexToBytes(f0_signed.sig)
    expect(der[0]).toBe(0x30)
    const signature = secp256k1.Signature.fromBytes(der, 'der')
    expect(secp256k1.verify(signature.toBytes('compact'), signing_digest(f0_unsigned), hexToBytes(f0_signed.key))).toBe(true)
    expect(f0_signed.key).toBe(validate_compressed_pubkey(TEST_PUBKEY_HEX))
  })

  test('§3.4.5 [MUST] the test-only private key k=1 is refused as a real identity', () => {
    expect(() => key_pair_from_private_key(TEST_PRIVATE_KEY)).toThrow('refused as a real identity')
  })

  test('§3.4.5 [MUST] the F0 unsigned entry encodes to exactly the 468 spec bytes', () => {
    expect(encode_canonical(f0_unsigned).length).toBe(signing_vector.unsigned_cbor_length)
    expect(signing_vector.unsigned_cbor_length).toBe(468)
  })

  test('§3.4.5 [vector] the F0 SHA-256 digest is fd55233a…', () => {
    expect(bytesToHex(signing_digest(f0_unsigned))).toBe(signing_vector.sha256_digest_hex)
  })

  test('§3.4.5 [vector] the F0 RFC 6979 signature is 3045022100ab7ece3c…', () => {
    expect(f0_signed.sig).toBe(signing_vector.signature_der_hex)
  })

  test('§3.4.5 [vector] verify_entry_signature accepts the F0 signed entry', () => {
    expect(verify_entry_signature({ entry: f0_signed })).toBe(true)
    expect(verify_entry_signature({ entry: { ...f0_signed, clock: { ...f0_signed.clock, time: 2 } } })).toBe(false)
  })

  test('§4.1.1 [MUST] the F0 signed entry hash is zBwWX7sbGgnam… (§4.1.1, §4.1.2)', () => {
    const hashed = hash_signed_entry(f0_signed)
    expect(hashed.bytes.length).toBe(signed_entry_vector.signed_cbor_length)
    expect(hashed.hash).toBe(signed_entry_vector.entry_hash)
    expect(decode_signed_entry(hashed.bytes).hash).toBe(signed_entry_vector.entry_hash)
  })

  test('§4.1.2 [vector] the child entry with non-empty next hashes to zBwWX6N1WUQh…, with next stored as strings', () => {
    const child_unsigned = vector_unsigned(child_entry_vector.unsigned_entry)
    expect(encode_canonical(child_unsigned).length).toBe(child_entry_vector.unsigned_cbor_length)
    expect(bytesToHex(signing_digest(child_unsigned))).toBe(child_entry_vector.sha256_digest_hex)
    const child = sign_entry({ unsigned_entry: child_unsigned, private_key: TEST_PRIVATE_KEY })
    expect(child.sig).toBe(child_entry_vector.signature_der_hex)
    const hashed = hash_signed_entry(child)
    expect(hashed.bytes.length).toBe(child_entry_vector.signed_cbor_length)
    expect(hashed.hash).toBe(child_entry_vector.entry_hash)
    expect(decode_signed_entry(hashed.bytes).entry.next).toEqual([signed_entry_vector.entry_hash])
  })
})
