// Access-control chain and append verification (§3.5), against
// src/access-control and src/oplog; chain pinning against the library
// lifecycle in src/peer.

import { describe, expect, test } from 'bun:test'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { authorise_entry } from '#access-control/capability.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { build_library_address } from '#encoding/library-address.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { create_oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { append_track, open_test_library, sign_raw, track_put } from '#test/helpers/library.ts'
import { create_memory_block_store } from '#test/helpers/memory-block-store.ts'
import { open_library_manager, pinned, write_chain } from '#test/helpers/library-manager.ts'
import type { BlockStore } from '#types/library.ts'
import { ac_chain_vector } from './vectors.ts'

const writer = generate_key_pair()
const outsider = generate_key_pair()

const put_object = async (block_store: BlockStore, value: unknown) => {
  const bytes = encode_canonical(value)
  const cid = compute_cid_string(bytes)
  await block_store.put(cid, bytes)
  return cid
}

// Builds a chain from hand-written objects, so each test can break one link.
const chain_from = async ({ write_list = { write: [writer.public_key] }, wrapper, manifest, name = 'library' }: {
  write_list?: unknown
  wrapper?: (write_list_cid: string) => unknown
  manifest?: (wrapper_cid: string) => unknown
  name?: string
}) => {
  const block_store = create_memory_block_store()
  const write_list_cid = await put_object(block_store, write_list)
  const wrapper_cid = await put_object(block_store, (wrapper ?? ((address) => ({ params: { address }, type: 'static' })))(write_list_cid))
  const manifest_cid = await put_object(block_store, (manifest ?? ((accessController) => ({ name: 'library', type: 'recordstore', accessController })))(wrapper_cid))
  return { block_store, library_address: build_library_address({ manifest_cid, name }) }
}

const resolve_from = async (input: Parameters<typeof chain_from>[0]) => resolve_ac_chain(await chain_from(input))

const signed_put = (key_pair: typeof writer, address: string) =>
  sign_raw({ private_key: key_pair.private_key, fields: { id: address, payload: track_put(), clock: { id: key_pair.public_key, time: 1 } } })

describe('ac-chain', () => {
  test('§3.5.1 [vector] F3 write-list, wrapper, and manifest CIDs and the assembled address match the spec', async () => {
    const { address, cids } = await create_ac_chain({
      name: ac_chain_vector.library_name,
      type: ac_chain_vector.library_type,
      write_keys: ac_chain_vector.write_keys,
      block_store: create_memory_block_store()
    })
    expect(cids).toEqual({ write_list: ac_chain_vector.write_list.cid, wrapper: ac_chain_vector.wrapper.cid, manifest: ac_chain_vector.manifest.cid })
    expect(address).toBe(ac_chain_vector.library_address)
  })

  test('§3.5.1 [check] creating a chain and resolving its address returns the same write-list', async () => {
    const block_store = create_memory_block_store()
    const write_keys = [writer.public_key, outsider.public_key]
    const { address, cids } = await create_ac_chain({ name: 'library', type: 'listens', write_keys, block_store })
    const chain = await resolve_ac_chain({ library_address: address, block_store })
    expect(chain.write_list).toEqual(write_keys)
    expect(chain.type).toBe('listens')
    expect(chain.cids).toEqual(cids)
  })

  test('§3.5.1 [MUST] all three chain objects are pinned when a library loads', async () => {
    const { content_store, manager } = open_library_manager()
    const { address, cids } = await write_chain({ content_store, name: 'library', writer })
    const chain_cids = [cids.manifest, cids.wrapper, cids.write_list]
    expect(await pinned(content_store, chain_cids)).toEqual([false, false, false])
    const handle = await manager.open_library(address)
    expect(await pinned(content_store, chain_cids)).toEqual([true, true, true])
    expect([...handle.pins.keys()]).toEqual(chain_cids)
  })

  test('§3.5.1 [MUST] chain objects are not unpinned while the library is in use', async () => {
    const { content_store, manager } = open_library_manager()
    // Same writer: the two chains share the wrapper and write-list objects.
    const in_use = await manager.create_library({ name: 'in-use', type: 'recordstore', write_keys: [writer.public_key] })
    const other = await manager.create_library({ name: 'other', type: 'listens', write_keys: [writer.public_key] })
    expect(other.chain.cids.write_list).toBe(in_use.chain.cids.write_list)
    expect(other.chain.cids.wrapper).toBe(in_use.chain.cids.wrapper)
    const chain_cids = [in_use.chain.cids.manifest, in_use.chain.cids.wrapper, in_use.chain.cids.write_list]
    // Unlinking a library that shares objects leaves the shared ones pinned.
    await manager.unlink_library(other.chain.address)
    expect(await pinned(content_store, chain_cids)).toEqual([true, true, true])
    expect(await content_store.is_pinned(other.chain.cids.manifest)).toBe(false)
  })

  test('§3.5.1 [MUST] a manifest that fails to decode or has the wrong field set rejects the library', async () => {
    const block_store = create_memory_block_store()
    const garbage = Uint8Array.from([0xff, 0x00])
    const garbage_cid = compute_cid_string(encode_canonical({ placeholder: true }))
    await block_store.put(garbage_cid, garbage)
    await expect(resolve_ac_chain({ library_address: build_library_address({ manifest_cid: garbage_cid, name: 'library' }), block_store }))
      .rejects.toThrow('does not decode')
    await expect(resolve_from({ manifest: (accessController) => ({ name: 'library', type: 'recordstore', accessController, extra: 1 }) }))
      .rejects.toThrow('manifest does not match')
    await expect(resolve_from({ manifest: (accessController) => ({ name: 'library', type: 'feed', accessController }) }))
      .rejects.toThrow('manifest does not match')
  })

  test('§3.5.1 [MUST] a manifest name that differs from the address name rejects the library', async () => {
    await expect(resolve_from({ name: 'other' })).rejects.toThrow('differs from address name')
  })

  test('§3.5.1 [MUST] an AC wrapper that does not match the wrapper shape rejects the library', async () => {
    await expect(resolve_from({ wrapper: (address) => ({ params: { address, write: [] }, type: 'static' }) })).rejects.toThrow('AC wrapper does not match')
    await expect(resolve_from({ wrapper: (address) => ({ address, type: 'static' }) })).rejects.toThrow('AC wrapper does not match')
  })

  test('§3.5.1 [MUST] an AC wrapper type the implementation does not recognise rejects the library', async () => {
    await expect(resolve_from({ wrapper: (address) => ({ params: { address }, type: 'orbitdb' }) })).rejects.toThrow('unrecognised AC type')
  })

  test('§3.5.1 [MUST] a write-list that does not match the write-list shape rejects the library', async () => {
    await expect(resolve_from({ write_list: { write: writer.public_key } })).rejects.toThrow('write-list does not match')
    await expect(resolve_from({ write_list: { write: [writer.public_key], admin: [] } })).rejects.toThrow('write-list does not match')
  })

  test('§3.5.1 [MUST] any invalid write-list element rejects the library', async () => {
    await expect(resolve_from({ write_list: { write: [writer.public_key, '*'] } })).rejects.toThrow('write-list element')
  })

  test('§3.5.1 [MUST] a chain object that cannot be fetched leaves the library unopenable', async () => {
    const { block_store, library_address } = await chain_from({})
    const [write_list_cid] = block_store.blocks.keys()
    block_store.blocks.delete(write_list_cid ?? '')
    await expect(resolve_ac_chain({ library_address, block_store })).rejects.toMatchObject({ code: 'library_unopenable' })
    const failing: BlockStore = { get: async () => { throw new Error('timeout') }, put: async () => {} }
    await expect(resolve_ac_chain({ library_address, block_store: failing })).rejects.toMatchObject({ code: 'library_unopenable' })
  })

  test('§3.5.1 [MUST] nothing proceeds on a library without a verified chain', async () => {
    const unverified = { address: '/record/x/library', name: 'library', type: 'recordstore', write_list: [], cids: {} }
    // @ts-expect-error an oplog takes only a ResolvedAcChain, which only resolve_ac_chain produces
    const bypass = () => create_oplog({ chain: unverified })
    expect(bypass).toBeTypeOf('function')
    const { block_store, library_address } = await chain_from({ name: 'other' })
    expect(await resolve_ac_chain({ library_address, block_store }).catch(() => undefined)).toBeUndefined()
  })

  test('§3.5.2 [MUST] a non-static AC type refuses open, replicate, and append', async () => {
    const rejected = resolve_from({ wrapper: (address) => ({ params: { address }, type: 'ipfs' }) })
    await expect(rejected).rejects.toMatchObject({ code: 'unsupported_ac_type' })
  })

  test('§3.5.3 [MUST] write-lists of any length load', async () => {
    for (const count of [0, 1, 7]) {
      const write = Array.from({ length: count }, () => generate_key_pair().public_key)
      expect((await resolve_from({ write_list: { write } })).write_list).toEqual(write)
    }
  })

  test('§3.5.3 [MUST] replicating peers verify the signer appears in the write-list', async () => {
    const { oplog } = await open_test_library({ writers: [writer] })
    const { rejected } = merge_entries({ oplog, blocks: [signed_put(outsider, oplog.chain.address).bytes] })
    expect(rejected.map(({ error }) => error.code)).toEqual(['unauthorised_writer'])
    expect(oplog.entries.size).toBe(0)
  })

  test('§3.5.4 [MUST] a remote entry signature is verified with entry.key before append', async () => {
    const { oplog } = await open_test_library({ writers: [writer, outsider] })
    const genuine = signed_put(writer, oplog.chain.address)
    // Claiming another listed writer's key does not verify.
    const claimed = sign_raw({ private_key: writer.private_key, fields: genuine.entry as never })
    const relabelled = { ...claimed.entry, key: outsider.public_key }
    const { rejected, merged } = merge_entries({ oplog, blocks: [encode_canonical(relabelled), genuine.bytes] })
    expect(rejected.map(({ error }) => error.code)).toEqual(['invalid_signature'])
    expect(merged.map(({ hash }) => hash)).toEqual([genuine.hash])
  })

  test('§3.5.4 [MUST] entry.key membership in the write-list is checked by plain string equality', async () => {
    const listed = await open_test_library({ writers: [outsider, writer] })
    const unlisted = await open_test_library({ writers: [outsider] })
    const authorise = ({ oplog }: typeof listed) => {
      const hashed = signed_put(writer, oplog.chain.address)
      return authorise_entry({ oplog, hashed, operation: hashed.entry.payload as never })
    }
    expect(authorise(listed)).toEqual({ ok: true })
    expect(authorise(unlisted)).toMatchObject({ ok: false, code: 'unauthorised_writer' })
  })

  test('§3.5.4 [MUST] an entry failing either check is rejected, including one signed by a key outside the write-list', async () => {
    const { oplog, writers: [key_pair] } = await open_test_library({ writers: [writer] })
    if (key_pair === undefined) throw new Error('fixture writer missing')
    append_track({ oplog, key_pair })
    const tampered = { ...signed_put(writer, oplog.chain.address).entry, sig: signed_put(outsider, oplog.chain.address).entry.sig }
    const { rejected } = merge_entries({ oplog, blocks: [encode_canonical(tampered), signed_put(outsider, oplog.chain.address).bytes] })
    expect(rejected.map(({ error }) => error.code).sort()).toEqual(['invalid_signature', 'unauthorised_writer'])
    expect(oplog.entries.size).toBe(1)
  })
})
