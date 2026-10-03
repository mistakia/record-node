// The identity library (§4.8.1 to §4.8.3), against src/entry/identity-record.ts,
// src/oplog, and the F9 vector.

import { describe, expect, test } from 'bun:test'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { derive_library_address } from '#encoding/library-address.ts'
import { sha256_hex } from '#encoding/sha256.ts'
import { canonical_cid } from '#entry/identity-record.ts'
import { hash_signed_entry, type HashedEntry } from '#entry/signed.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import { sign_entry } from '#identity/signing.ts'
import { create_oplog, type Oplog } from '#oplog/dag.ts'
import { identity_library_state } from '#oplog/identity-library.ts'
import { merge_entries } from '#oplog/merge.ts'
import type { UnsignedEntry } from '#types/entry.ts'
import { create_memory_block_store } from '#test/helpers/memory-block-store.ts'
import { test_key } from './capability-vector.ts'
import { META_LOG_PIN_CID, META_LOG_PIN_SOURCE_CID, META_LOG_T0, meta_log_vector } from './vectors.ts'

const K = test_key(1)
const address_of = (key: KeyPair, discriminator: string) => derive_library_address({ key: key.public_key, type: 'recordstore', discriminator })
const OWN = address_of(K, 'library')
const FRIEND = address_of(test_key(2), 'library')
const MIXES = address_of(K, 'mixes')

const open_identity_library = async (key: KeyPair = K): Promise<Oplog> => {
  const block_store = create_memory_block_store()
  const { address } = await create_ac_chain({ name: 'identity', type: 'identity', write_keys: [key.public_key], block_store })
  return create_oplog({ chain: await resolve_ac_chain({ library_address: address, block_store }) })
}

const sign = ({ oplog, key_pair = K, payload, next, time }: {
  oplog: Oplog
  key_pair?: KeyPair
  payload: unknown
  next: readonly string[]
  time: number
}): HashedEntry => hash_signed_entry(sign_entry({
  unsigned_entry: { id: oplog.chain.address, payload, next, refs: [], v: 2, clock: { id: key_pair.public_key, time } } as unknown as UnsignedEntry,
  private_key: key_pair.private_key
}))

// The F9 chain: each entry cites the one before.
const F9_OPERATIONS = [
  { op: 'PUT', key: sha256_hex(OWN), value: { type: 'library', v: 1, timestamp: META_LOG_T0, address: OWN } },
  { op: 'PUT', key: sha256_hex(FRIEND), value: { type: 'link', v: 1, timestamp: META_LOG_T0 + 1, address: FRIEND, alias: 'friend' } },
  { op: 'PUT', key: sha256_hex(META_LOG_PIN_CID), value: { type: 'pin', v: 1, timestamp: META_LOG_T0 + 2, cid: META_LOG_PIN_CID } },
  { op: 'DEL', key: sha256_hex(FRIEND), value: { type: 'link', timestamp: META_LOG_T0 + 3 } },
  { op: 'PUT', key: sha256_hex(MIXES), value: { type: 'library', v: 1, timestamp: META_LOG_T0 + 4, address: MIXES } },
  { op: 'PUT', key: sha256_hex(MIXES), value: { type: 'link', v: 1, timestamp: META_LOG_T0 + 5, address: MIXES } },
  { op: 'DEL', key: sha256_hex(MIXES), value: { type: 'link', timestamp: META_LOG_T0 + 6 } },
  { op: 'DEL', key: sha256_hex(MIXES), value: { type: 'library', timestamp: META_LOG_T0 + 7 } },
  { op: 'PUT', key: sha256_hex(MIXES), value: { type: 'library', v: 1, timestamp: META_LOG_T0 + 8, address: MIXES } }
]

const f9_chain = (oplog: Oplog): HashedEntry[] => F9_OPERATIONS.reduce<HashedEntry[]>((chain, payload, index) => {
  const previous = chain[chain.length - 1]
  return [...chain, sign({ oplog, payload, next: previous === undefined ? [] : [previous.hash], time: index + 1 })]
}, [])

describe('identity-library', () => {
  test('§4.8.2 [vector] F9 nine identity-library entries sign to the spec hashes and sizes', async () => {
    const chain = f9_chain(await open_identity_library())
    expect(chain.map(({ hash, bytes }) => ({ hash, size: bytes.length })))
      .toEqual(meta_log_vector.map(({ entry_hash, signed_bytes }) => ({ hash: entry_hash, size: signed_bytes })))
  })

  test('§4.8.2 [vector] F9 a pin keys on the CIDv1 base32 form of the audio CID', () => {
    expect(canonical_cid(META_LOG_PIN_SOURCE_CID)).toBe(META_LOG_PIN_CID)
    expect(canonical_cid(META_LOG_PIN_CID)).toBe(META_LOG_PIN_CID)
  })

  test('§4.8.2 [vector] F9 current state resolves per (type, key), and §4.8.3 retirement is terminal', async () => {
    const oplog = await open_identity_library()
    const chain = f9_chain(oplog)
    const before_retirement = merge_entries({ oplog, blocks: chain.slice(0, 7).map(({ bytes }) => bytes) })
    expect(before_retirement.rejected).toEqual([])
    const early = identity_library_state(oplog)
    // The mixes library and link records share a key and resolve apart.
    expect(early.libraries.get(MIXES)).toEqual({ retired: false })
    expect(early.links.has(MIXES)).toBe(false)
    merge_entries({ oplog, blocks: chain.slice(7).map(({ bytes }) => bytes) })
    const state = identity_library_state(oplog)
    expect(state.libraries).toEqual(new Map([[OWN, { retired: false }], [MIXES, { retired: true }]]))
    expect(state.links).toEqual(new Map())
    expect(state.link_keys).toEqual(new Set([sha256_hex(FRIEND), sha256_hex(MIXES)]))
    expect(state.pins).toEqual(new Set([META_LOG_PIN_CID]))
  })

  test('§4.8.2 [MUST] a record of a defined type that breaks its shape is rejected', async () => {
    const oplog = await open_identity_library()
    const malformed = [
      { op: 'PUT', key: sha256_hex(META_LOG_PIN_SOURCE_CID), value: { type: 'pin', v: 1, timestamp: META_LOG_T0, cid: META_LOG_PIN_SOURCE_CID } },
      { op: 'PUT', key: sha256_hex(FRIEND), value: { type: 'link', v: 1, timestamp: META_LOG_T0, address: FRIEND, alias: 'x'.repeat(129) } },
      { op: 'PUT', key: sha256_hex(FRIEND), value: { type: 'link', v: 1, timestamp: META_LOG_T0, address: 'not-an-address' } },
      { op: 'PUT', key: sha256_hex(OWN), value: { type: 'library', v: 1, timestamp: META_LOG_T0, address: OWN, extra: true } },
      { op: 'PUT', key: sha256_hex(FRIEND), value: { type: 'library', v: 1, timestamp: META_LOG_T0, address: OWN } },
      { op: 'DEL', key: sha256_hex(OWN), value: { type: 'library', timestamp: META_LOG_T0, address: OWN } }
    ]
    const { merged, rejected } = merge_entries({ oplog, blocks: malformed.map((payload) => sign({ oplog, payload, next: [], time: 1 }).bytes) })
    expect(merged).toEqual([])
    expect(rejected.map(({ error }) => error.code)).toEqual(Array(malformed.length).fill('invalid_shape'))
  })

  test('§4.8.1 [MUST] an entry signed by another key, or carrying capability_id, is rejected', async () => {
    const oplog = await open_identity_library()
    const link = { op: 'PUT', key: sha256_hex(FRIEND), value: { type: 'link', v: 1, timestamp: META_LOG_T0, address: FRIEND } }
    const { rejected } = merge_entries({
      oplog,
      blocks: [
        sign({ oplog, key_pair: test_key(2), payload: link, next: [], time: 1 }).bytes,
        sign({ oplog, payload: { ...link, capability_id: 'zx' }, next: [], time: 1 }).bytes
      ]
    })
    expect(rejected.map(({ error }) => error.code).sort()).toEqual(['invalid_operation', 'unauthorised_writer'])
  })

  test('§4.8.2 [MUST] a record type this version does not define merges with no state effect', async () => {
    const oplog = await open_identity_library()
    const unknown = sign({ oplog, payload: { op: 'PUT', key: 'anything', value: { type: 'playlist', v: 1, timestamp: META_LOG_T0 } }, next: [], time: 1 })
    const { merged } = merge_entries({ oplog, blocks: [unknown.bytes] })
    expect(merged.map(({ hash }) => hash)).toEqual([unknown.hash])
    expect(oplog.current.size).toBe(0)
    expect(identity_library_state(oplog)).toEqual({ libraries: new Map(), links: new Map(), link_keys: new Set(), pins: new Set() })
  })
})
