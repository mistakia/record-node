// Entry signing (§3.4).
//
// The signing input is dag-cbor(unsigned entry); its SHA-256 digest is the
// message handed to ECDSA/secp256k1-with-SHA-256, RFC 6979 nonce, DER output.
// noble's default prehash therefore hashes the digest once more, and the
// §3.4.5 vector pins exactly that: prehash: false over the digest, or signing
// the raw CBOR, both produce a different signature.

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import type { SignedEntry, UnsignedEntry } from '#types/entry.ts'
import { compressed_pubkey_from_private } from './key-pair.ts'

// Exactly the six signed fields, so neither a stray hash nor key/sig on the
// input can reach the signing bytes (§3.4.1).
export const unsigned_fields = ({ id, payload, next, refs, v, clock }: UnsignedEntry): UnsignedEntry =>
  ({ id, payload, next, refs, v, clock })

export const signing_digest = (unsigned_entry: UnsignedEntry): Uint8Array =>
  sha256(encode_canonical(unsigned_fields(unsigned_entry)))

export const sign_entry = ({ unsigned_entry, private_key }: {
  unsigned_entry: UnsignedEntry
  private_key: Uint8Array
}): SignedEntry => {
  const signature = secp256k1.sign(signing_digest(unsigned_entry), private_key, { format: 'der' })
  return Object.freeze({
    ...unsigned_fields(unsigned_entry),
    key: compressed_pubkey_from_private(private_key),
    sig: bytesToHex(signature)
  })
}
