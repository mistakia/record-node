// Canonical dag-cbor (RFC 8949 deterministic encoding) behind a branded type,
// so no raw Uint8Array reaches a signing, hashing, or wire path (§2.1, §3.4.2).

import { encode, decode } from '@ipld/dag-cbor'

import { ProtocolError } from '#types/errors.ts'

declare const canonical_bytes_brand: unique symbol

export type CanonicalBytes = Uint8Array & { readonly [canonical_bytes_brand]: true }

export const encode_canonical = (value: unknown): CanonicalBytes =>
  encode(value) as CanonicalBytes

const bytes_equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

// Readers reject non-canonical input instead of re-encoding it (§2.1): the
// input must equal the canonical encoding of what it decodes to.
export const decode_canonical = (bytes: Uint8Array): { value: unknown, bytes: CanonicalBytes } => {
  let value: unknown
  try {
    value = decode(bytes)
  } catch (error) {
    throw new ProtocolError('malformed_encoding', `dag-cbor decode failed: ${(error as Error).message}`)
  }
  if (!bytes_equal(encode(value), bytes)) {
    throw new ProtocolError('non_canonical_encoding', 'input is not canonical dag-cbor')
  }
  return { value, bytes: bytes as CanonicalBytes }
}
