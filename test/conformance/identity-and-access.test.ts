// Keys, addresses, and library names (§3.1, §3.3, §3.6, §3.7), against
// src/identity, src/encoding, src/access-control, and src/oplog.

import { describe, expect, test } from 'bun:test'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { parse_library_address, validate_library_name } from '#encoding/library-address.ts'
import { decode_signed_entry } from '#entry/signed.ts'
import { generate_key_pair, validate_compressed_pubkey } from '#identity/key-pair.ts'
import { create_oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { append_track, blocks_of, open_test_library, sign_raw } from '#test/helpers/library.ts'
import { create_memory_block_store } from '#test/helpers/memory-block-store.ts'

const writer = generate_key_pair()
const point = secp256k1.Point.fromBytes(secp256k1.getPublicKey(writer.private_key, true))
const uncompressed = bytesToHex(point.toBytes(false))
const hybrid = (point.y % 2n === 0n ? '06' : '07') + uncompressed.slice(2)

describe('identity-and-access', () => {
  test('§3.1 [MUST] an entry.key or write-list element that is not 66 lowercase hex starting 02 or 03 is rejected', async () => {
    for (const key of [writer.public_key.toUpperCase(), writer.public_key.slice(0, 64), `05${writer.public_key.slice(2)}`, 42]) {
      expect(() => validate_compressed_pubkey(key)).toThrow('not a compressed secp256k1 pubkey hex')
    }
    const forged = sign_raw({ private_key: writer.private_key, fields: { id: 'x', payload: {}, clock: { id: writer.public_key, time: 1 } } })
    const upper_key = { ...forged.entry, key: forged.entry.key.toUpperCase() }
    expect(() => decode_signed_entry(encode_canonical(upper_key))).toThrow('entry.key is not a compressed pubkey hex')
    const block_store = create_memory_block_store()
    const { address } = await create_ac_chain({ name: 'library', type: 'recordstore', write_keys: [writer.public_key], block_store })
    await expect(resolve_ac_chain({ library_address: address, block_store })).resolves.toBeDefined()
    await expect(create_ac_chain({ name: 'library', type: 'recordstore', write_keys: [writer.public_key.toUpperCase()], block_store }))
      .rejects.toThrow('not a compressed secp256k1 pubkey hex')
  })

  test('§3.1 [MUST] uncompressed (04) and hybrid (06, 07) keys are rejected even when mathematically equivalent', () => {
    expect(uncompressed.startsWith('04')).toBe(true)
    expect(() => validate_compressed_pubkey(uncompressed)).toThrow('not a compressed secp256k1 pubkey hex')
    expect(() => validate_compressed_pubkey(hybrid)).toThrow('not a compressed secp256k1 pubkey hex')
  })

  test('§3.3 [MUST] a library whose writer stopped appending stays valid', async () => {
    const { oplog, writers: [key_pair] } = await open_test_library()
    if (key_pair === undefined) throw new Error('fixture writer missing')
    append_track({ oplog, key_pair, fingerprint: 'old', timestamp: 1 })
    append_track({ oplog, key_pair, fingerprint: 'older', timestamp: 2 })
    // A later peer replicating the abandoned library accepts every entry.
    const replica = create_oplog({ chain: oplog.chain })
    const { merged, rejected } = merge_entries({ oplog: replica, blocks: blocks_of(oplog) })
    expect(merged.length).toBe(2)
    expect(rejected).toEqual([])
  })

  test('§3.6 [MUST] a library address has the exact form /record/<manifest-cid>/<name>', async () => {
    const block_store = create_memory_block_store()
    const { address, cids } = await create_ac_chain({ name: 'my-library', type: 'recordstore', write_keys: [writer.public_key], block_store })
    expect(address).toBe(`/record/${cids.manifest}/my-library`)
    expect(parse_library_address(address)).toEqual({ manifest_cid: cids.manifest, name: 'my-library' })
    for (const malformed of [`/orbitdb/${cids.manifest}/my-library`, `/record/${cids.manifest}`, '/record/not-a-cid/library']) {
      expect(() => parse_library_address(malformed)).toThrow()
    }
  })

  test('§3.6 [MUST] addresses are transported and compared as opaque strings', async () => {
    const { oplog, writers: [key_pair] } = await open_test_library()
    if (key_pair === undefined) throw new Error('fixture writer missing')
    const entry = append_track({ oplog, key_pair })
    expect(oplog.chain.address).toBeTypeOf('string')
    expect(entry.entry.id).toBe(oplog.chain.address)
  })

  test('§3.7 [MUST] library names match ^[0-9a-zA-Z-]*$', () => {
    for (const name of ['library', 'My-Library-2', '']) expect(validate_library_name(name)).toBe(name)
    for (const name of ['my library', 'a/b', 'a_b', 'café', 'a.b']) {
      expect(() => validate_library_name(name)).toThrow('library name must match')
    }
  })

  test('§3.7 [MUST] library creation enforces the name character set', async () => {
    const block_store = create_memory_block_store()
    await expect(create_ac_chain({ name: 'bad name', type: 'recordstore', write_keys: [writer.public_key], block_store }))
      .rejects.toThrow('library name must match')
    expect(block_store.blocks.size).toBe(0)
  })
})
