// Signed entries at rest and on the wire (§4.1): the exact 8-field object,
// its canonical bytes, and its entry hash.

import { base58btc } from 'multiformats/bases/base58'
import type { CID } from 'multiformats/cid'

import { decode_canonical, encode_canonical, type CanonicalBytes } from '#encoding/canonical-bytes.ts'
import { compute_cid } from '#encoding/cid.ts'
import { assert_signed_entry_size } from '#encoding/size-bounds.ts'
import { is_compressed_pubkey } from '#identity/key-pair.ts'
import type { SignedEntry } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { is_record } from '#types/guards.ts'
import { assert_unsigned_fields } from './build.ts'

const SIGNED_ENTRY_FIELDS = ['id', 'payload', 'next', 'refs', 'v', 'clock', 'key', 'sig']

// A signed entry with its local-only hash (§4.1.2). The hash is never a
// field of the entry, so it cannot leak into the stored bytes.
export interface HashedEntry {
  readonly hash: string
  readonly multihash: Uint8Array
  readonly bytes: CanonicalBytes
  readonly entry: SignedEntry
}

export const assert_signed_entry_shape = (value: unknown): SignedEntry => {
  if (!is_record(value)) throw new ProtocolError('invalid_shape', 'a signed entry must be a map')
  const fields = Object.keys(value)
  if (fields.length !== SIGNED_ENTRY_FIELDS.length || !SIGNED_ENTRY_FIELDS.every((field) => fields.includes(field))) {
    throw new ProtocolError('invalid_shape', `a signed entry has exactly the fields ${SIGNED_ENTRY_FIELDS.join(', ')}`)
  }
  if (!is_compressed_pubkey(value.key)) {
    throw new ProtocolError('invalid_public_key', `entry.key is not a compressed pubkey hex: ${String(value.key)}`)
  }
  if (typeof value.sig !== 'string') throw new ProtocolError('invalid_shape', 'entry.sig must be a string')
  return { ...assert_unsigned_fields(value), key: value.key, sig: value.sig }
}

const with_hash = ({ entry, bytes, cid }: { entry: SignedEntry, bytes: CanonicalBytes, cid: CID }): HashedEntry =>
  Object.freeze({ hash: cid.toString(base58btc), multihash: cid.multihash.bytes, bytes, entry })

export const hash_signed_entry = (entry: SignedEntry): HashedEntry => {
  const { id, payload, next, refs, v, clock, key, sig } = entry
  const bytes = encode_canonical({ id, payload, next, refs, v, clock, key, sig })
  return with_hash({ entry, bytes, cid: compute_cid(bytes) })
}

// Size first, then canonical form, then shape: an oversized or malformed
// entry is dropped before any signature work (§2.8.3).
export const decode_signed_entry = (bytes: Uint8Array): HashedEntry => {
  assert_signed_entry_size(bytes)
  const decoded = decode_canonical(bytes)
  const entry = assert_signed_entry_shape(decoded.value)
  return with_hash({ entry, bytes: decoded.bytes, cid: compute_cid(decoded.bytes) })
}
