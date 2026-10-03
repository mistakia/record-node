// Protocol-object CIDs: dag-cbor, sha3-512, CIDv1, base58btc (§2.1, §4.1.2).

import { code as DAG_CBOR_CODE } from '@ipld/dag-cbor'
import { sha3_512 } from '@noble/hashes/sha3.js'
import { base58btc } from 'multiformats/bases/base58'
import { CID } from 'multiformats/cid'
import { create as create_digest } from 'multiformats/hashes/digest'

import { ProtocolError } from '#types/errors.ts'
import type { CanonicalBytes } from './canonical-bytes.ts'

export const SHA3_512_CODE = 0x14
const SHA3_512_LENGTH = 64

export const compute_cid = (bytes: CanonicalBytes): CID =>
  CID.createV1(DAG_CBOR_CODE, create_digest(SHA3_512_CODE, sha3_512(bytes)))

// The string written into envelope.content, next, refs, and entry.hash.
export const compute_cid_string = (bytes: CanonicalBytes): string =>
  compute_cid(bytes).toString(base58btc)

// Parse a protocol-object CID string, requiring the exact §2.1 profile and
// its canonical base58btc spelling.
export const parse_cid = (cid_string: string): CID => {
  let cid: CID
  try {
    cid = CID.parse(cid_string, base58btc)
  } catch {
    throw new ProtocolError('invalid_cid', `not a base58btc CID: ${cid_string}`)
  }
  const matches_profile = cid.version === 1 &&
    cid.code === DAG_CBOR_CODE &&
    cid.multihash.code === SHA3_512_CODE &&
    cid.multihash.size === SHA3_512_LENGTH &&
    cid.toString(base58btc) === cid_string
  if (!matches_profile) {
    throw new ProtocolError('invalid_cid', `not a dag-cbor sha3-512 CIDv1: ${cid_string}`)
  }
  return cid
}

export const is_protocol_cid = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    parse_cid(value)
    return true
  } catch {
    return false
  }
}

// Audio, artwork, and avatar CIDs follow the content network's import
// profile (§2.1, §6.2.4), so any codec and hash is accepted, but always as a
// base58btc string in an entry, never as a dag-cbor link (v1.0.4).
export const is_cid_string = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  try {
    CID.parse(value, base58btc)
    return true
  } catch {
    return false
  }
}
