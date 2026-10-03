// Signature verification (§3.4.4).
//
// OpenSSL does the curve arithmetic when the runtime's node:crypto has
// secp256k1, about six times faster than noble, which a library open spends
// most of its CPU on. noble still parses the DER signature, so which
// encodings verify never depends on the runtime. Bun's BoringSSL lacks the
// curve, so under Bun noble verifies alone.

import { createPublicKey, verify, type KeyObject } from 'node:crypto'

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hexToBytes } from '@noble/hashes/utils.js'

import type { SignedEntry } from '#types/entry.ts'
import { is_compressed_pubkey } from './key-pair.ts'
import { signing_digest } from './signing.ts'

// SubjectPublicKeyInfo for an id-ecPublicKey on secp256k1, up to the
// 33-byte compressed point.
const SPKI_PREFIX = hexToBytes('3036301006072a8648ce3d020106052b8104000a032200')
const KEY_CACHE_LIMIT = 1024

const public_key = (compressed_hex: string): KeyObject =>
  createPublicKey({ key: Buffer.concat([SPKI_PREFIX, hexToBytes(compressed_hex)]), format: 'der', type: 'spki' })

// The generator point, a key every secp256k1 implementation accepts.
const GENERATOR = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

const native_available = (() => {
  try {
    public_key(GENERATOR)
    return true
  } catch {
    return false
  }
})()

export const signature_backend: 'openssl' | 'noble' = native_available ? 'openssl' : 'noble'

// Few distinct keys sign a library's entries, so their key objects are kept.
const keys = new Map<string, KeyObject>()
const cached_public_key = (compressed_hex: string): KeyObject => {
  let key = keys.get(compressed_hex)
  if (key === undefined) {
    if (keys.size >= KEY_CACHE_LIMIT) keys.clear()
    key = public_key(compressed_hex)
    keys.set(compressed_hex, key)
  }
  return key
}

// noble prehashes the digest with sha256, as node:crypto's 'sha256' does.
const verify_native = ({ sig, digest, key }: { sig: string, digest: Uint8Array, key: string }): boolean => {
  const compact = secp256k1.Signature.fromBytes(hexToBytes(sig), 'der').toBytes('compact')
  return verify('sha256', digest, { key: cached_public_key(key), dsaEncoding: 'ieee-p1363' }, compact)
}

// Any valid ECDSA signature verifies: the spec does not require low-S, so
// rejecting high-S would split peers on an otherwise valid entry.
export const verify_entry_signature = ({ entry }: { entry: SignedEntry }): boolean => {
  try {
    const digest = signing_digest(entry)
    if (native_available && is_compressed_pubkey(entry.key)) return verify_native({ sig: entry.sig, digest, key: entry.key })
    return secp256k1.verify(hexToBytes(entry.sig), digest, hexToBytes(entry.key), { format: 'der', lowS: false })
  } catch {
    return false
  }
}
