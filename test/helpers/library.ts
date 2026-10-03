// In-process library fixtures: a resolved AC chain, an oplog, and helpers to
// append, sign raw entries, and compare oplog state.

import { hexToBytes } from '@noble/hashes/utils.js'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { build_track_envelope } from '#entry/envelope.ts'
import { compute_track_id } from '#entry/id.ts'
import { build_put_operation } from '#entry/operations.ts'
import { hash_signed_entry } from '#entry/signed.ts'
import { generate_key_pair, type KeyPair } from '#identity/key-pair.ts'
import { sign_entry } from '#identity/signing.ts'
import { append_entry, create_oplog, type Oplog } from '#oplog/dag.ts'
import type { UnsignedEntry } from '#types/entry.ts'
import type { LibraryType } from '#types/library.ts'
import { TEST_PRIVATE_KEY_HEX } from '#test/conformance/vectors.ts'
import { create_memory_block_store } from './memory-block-store.ts'

export const TEST_PRIVATE_KEY = hexToBytes(TEST_PRIVATE_KEY_HEX)

export const content_cid_of = (value: unknown): string => compute_cid_string(encode_canonical(value))

export const open_test_library = async ({ name = 'library', type = 'recordstore', writers = [generate_key_pair()] }: {
  name?: string
  type?: LibraryType
  writers?: KeyPair[]
} = {}) => {
  const block_store = create_memory_block_store()
  const { address } = await create_ac_chain({ name, type, write_keys: writers.map(({ public_key }) => public_key), block_store })
  const chain = await resolve_ac_chain({ library_address: address, block_store })
  return { chain, block_store, writers, oplog: create_oplog({ chain }) }
}

export const track_put = ({ fingerprint = 'AQADtEmSaImS', content = { n: 0 }, timestamp, tags }: {
  fingerprint?: string
  content?: unknown
  timestamp?: number
  tags?: readonly string[]
} = {}) => build_put_operation({
  envelope: build_track_envelope({
    id: compute_track_id(fingerprint),
    content_cid: content_cid_of(content),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(tags === undefined ? {} : { tags })
  })
})

export const append_track = ({ oplog, key_pair, ...track }: {
  oplog: Oplog
  key_pair: KeyPair
} & Parameters<typeof track_put>[0]) => append_entry({ oplog, key_pair, payload: track_put(track) })

// Signs arbitrary fields without the builder's checks, to forge the hostile
// or malformed entries a remote peer could send.
export const sign_raw = ({ private_key, fields }: { private_key: Uint8Array, fields: Record<string, unknown> }) =>
  hash_signed_entry(sign_entry({ unsigned_entry: { v: 2, next: [], refs: [], ...fields } as unknown as UnsignedEntry, private_key }))

export const blocks_of = (oplog: Oplog): Uint8Array[] => [...oplog.entries.values()].map(({ bytes }) => bytes)

export const oplog_state = (oplog: Oplog) => ({
  entries: [...oplog.entries.keys()].sort(),
  heads: [...oplog.heads].sort(),
  current: [...oplog.current].map(([key, entry]) => [key, entry.hash]).sort()
})
