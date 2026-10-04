// ContentStore contract, run against the in-memory and Helia backends.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Readable } from 'node:stream'
import { encode as encode_dag_pb, code as DAG_PB_CODE, type PBLink } from '@ipld/dag-pb'
import { base58btc } from 'multiformats/bases/base58'
import { CID } from 'multiformats/cid'
import { code as RAW_CODE } from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { build_multi_block_input, multi_block_vector } from '#test/conformance/vectors.ts'
import { open_offline_helia_store } from '#test/helpers/helia.ts'

const MIB = 1024 * 1024

const backends: Array<[string, () => Promise<{ store: ContentStore, stop: () => Promise<unknown> }>]> = [
  ['memory', async () => ({ store: create_memory_content_store(), stop: async () => {} })],
  ['helia', async () => {
    const { helia, content_store } = await open_offline_helia_store()
    return { store: content_store, stop: async () => await helia.stop() }
  }]
]

const protocol_object = (value: unknown) => {
  const bytes = encode_canonical(value)
  return { cid: compute_cid_string(bytes), bytes }
}

const raw_block = async (bytes: Uint8Array) =>
  ({ cid: CID.createV1(RAW_CODE, await sha256.digest(bytes)).toString(base58btc), bytes })

// A dag-pb node linking to the given CIDs, as UnixFS interior nodes do.
// dag-pb is on multiformats 14 and the core on 13, hence the cast.
const dag_pb_node = async (links: string[]) => {
  const bytes = encode_dag_pb({ Links: links.map((link) => ({ Hash: CID.parse(link) as unknown as PBLink['Hash'], Tsize: 0 })) })
  return { cid: CID.createV1(DAG_PB_CODE, await sha256.digest(bytes)).toString(base58btc), bytes }
}

describe.each(backends)('%s ContentStore', (_name, open) => {
  let store: ContentStore
  let stop: () => Promise<unknown>

  beforeEach(async () => {
    ({ store, stop } = await open())
  })
  afterEach(async () => await stop())

  test('stores and returns a protocol object by CID', async () => {
    const { cid, bytes } = protocol_object({ hello: 'world' })
    expect(await store.has(cid)).toBe(false)
    expect(await store.get(cid)).toBeUndefined()
    await store.put(cid, bytes)
    expect(await store.has(cid)).toBe(true)
    expect(await store.get(cid)).toEqual(bytes)
  })

  test('rejects bytes that do not hash to the CID', async () => {
    const { cid } = protocol_object({ hello: 'world' })
    expect(store.put(cid, encode_canonical({ hello: 'there' }))).rejects.toMatchObject({ code: 'cid_mismatch' })
    expect(await store.has(cid)).toBe(false)
  })

  test('rejects a string that is not a CID', async () => {
    expect(store.get('not-a-cid')).rejects.toMatchObject({ code: 'invalid_cid' })
  })

  test('accepts a CIDv0', async () => {
    expect(await store.has('QmY7Yh4UquoXHLPFo2XbhXkhBvFoPwmQUSa92pxnxjQuPU')).toBe(false)
  })

  test('evicts an unpinned block, and never one a direct or recursive pin covers', async () => {
    const loose = await raw_block(new TextEncoder().encode('loose'))
    const direct = await raw_block(new TextEncoder().encode('direct'))
    const leaf = await raw_block(new TextEncoder().encode('leaf'))
    for (const block of [loose, direct, leaf]) await store.put(block.cid, block.bytes)
    const root = await dag_pb_node([leaf.cid])
    await store.put(root.cid, root.bytes)
    await store.pin(direct.cid)
    await store.pin(root.cid, { recursive: true })
    expect(await store.evict(loose.cid)).toBe(true)
    expect(await store.has(loose.cid)).toBe(false)
    expect(await store.evict(loose.cid)).toBe(false)
    expect(await Promise.all([direct, root, leaf].map(async ({ cid }) => await store.evict(cid)))).toEqual([false, false, false])
    expect(await Promise.all([direct, root, leaf].map(async ({ cid }) => await store.has(cid)))).toEqual([true, true, true])
    // Once unpinned, it goes.
    await store.unpin(root.cid)
    expect(await store.evict(leaf.cid)).toBe(true)
  })

  test('serves as the BlockStore for an AC chain', async () => {
    const { address, cids } = await create_ac_chain({ name: 'library', type: 'recordstore', write_keys: [generate_key_pair().public_key], block_store: store })
    expect((await resolve_ac_chain({ library_address: address, block_store: store })).cids).toEqual(cids)
  })

  test('imports bytes, a file path, and a stream to the same CID', async () => {
    const bytes = build_multi_block_input()
    const path = `${process.env.TMPDIR ?? '/tmp'}/content-store-${crypto.randomUUID()}.bin`
    await Bun.write(path, bytes)
    expect(await store.import_blob(bytes)).toBe(multi_block_vector.cid)
    expect(await store.import_blob(path)).toBe(multi_block_vector.cid)
    expect(await store.import_blob(Readable.from([bytes.subarray(0, 12345), bytes.subarray(12345)]))).toBe(multi_block_vector.cid)
    expect(await store.has(multi_block_vector.cid)).toBe(true)
  })

  test('an eviction and a pin issued together never leave a pinned block missing', async () => {
    for (const evict_first of [true, false]) {
      const leaf = await raw_block(new TextEncoder().encode(`raced ${evict_first}`))
      const root = await dag_pb_node([leaf.cid])
      for (const block of [leaf, root]) await store.put(block.cid, block.bytes)
      const pin = async () => { await store.pin(root.cid, { recursive: true }).catch(() => {}) }
      const evict = async () => { await store.evict(leaf.cid) }
      await Promise.all(evict_first ? [evict(), pin()] : [pin(), evict()])
      if (await store.is_pinned(leaf.cid)) expect(await store.has(leaf.cid)).toBe(true)
      else expect(await store.is_pinned(root.cid)).toBe(false)
    }
  })

  test('a direct pin covers the block alone', async () => {
    const leaf = await raw_block(new Uint8Array([1]))
    const root = await dag_pb_node([leaf.cid])
    await store.put(leaf.cid, leaf.bytes)
    await store.put(root.cid, root.bytes)
    await store.pin(root.cid)
    expect(await store.is_pinned(root.cid)).toBe(true)
    expect(await store.is_pinned(leaf.cid)).toBe(false)
    await store.unpin(root.cid)
    expect(await store.is_pinned(root.cid)).toBe(false)
  })

  test('a recursive pin covers every block of an imported blob', async () => {
    const cid = await store.import_blob(build_multi_block_input())
    const leaf = await raw_block(build_multi_block_input(MIB))
    await store.pin(cid, { recursive: true })
    expect(await store.is_pinned(cid)).toBe(true)
    expect(await store.is_pinned(leaf.cid)).toBe(true)
    await store.unpin(cid)
    expect(await store.is_pinned(cid)).toBe(false)
    expect(await store.is_pinned(leaf.cid)).toBe(false)
  })

  test('pin is idempotent and a recursive pin supersedes a direct one', async () => {
    const cid = await store.import_blob(build_multi_block_input())
    const leaf = await raw_block(build_multi_block_input(MIB))
    await store.pin(cid)
    await store.pin(cid)
    expect(await store.is_pinned(leaf.cid)).toBe(false)
    await store.pin(cid, { recursive: true })
    await store.pin(cid)
    expect(await store.is_pinned(leaf.cid)).toBe(true)
    await store.unpin(cid)
    await store.unpin(cid)
    expect(await store.is_pinned(cid)).toBe(false)
  })

  test('pinning a block that is not stored rejects and pins nothing', async () => {
    const stored = await raw_block(new Uint8Array([1]))
    const missing = await raw_block(new Uint8Array([2]))
    const root = await dag_pb_node([stored.cid, missing.cid])
    expect(store.pin(missing.cid)).rejects.toMatchObject({ code: 'content_unavailable' })
    await store.put(stored.cid, stored.bytes)
    await store.put(root.cid, root.bytes)
    expect(store.pin(root.cid, { recursive: true })).rejects.toMatchObject({ code: 'content_unavailable' })
    expect(await store.is_pinned(root.cid)).toBe(false)
    expect(await store.is_pinned(stored.cid)).toBe(false)
  })

  test('a block shared by two recursive pins stays pinned until both are gone', async () => {
    const shared = await raw_block(build_multi_block_input(MIB))
    const first = await store.import_blob(build_multi_block_input())
    const second = await store.import_blob(build_multi_block_input(2 * MIB))
    await store.pin(first, { recursive: true })
    await store.pin(second, { recursive: true })
    await store.unpin(first)
    expect(await store.is_pinned(shared.cid)).toBe(true)
    await store.pin(first, { recursive: true })
    await store.unpin(second)
    expect(await store.is_pinned(shared.cid)).toBe(true)
    await store.unpin(first)
    expect(await store.is_pinned(shared.cid)).toBe(false)
  })

  test('concurrent pins and unpins of blobs sharing a block keep its count exact', async () => {
    const shared = await raw_block(build_multi_block_input(MIB))
    const blobs = await Promise.all([2, 3, 4, 5, 6, 7, 8, 9].map(async (mib) => await store.import_blob(build_multi_block_input(mib * MIB))))
    await Promise.all([...blobs, ...blobs].map(async (cid) => { await store.pin(cid, { recursive: true }) }))
    await Promise.all(blobs.slice(1).map(async (cid) => { await store.unpin(cid) }))
    expect(await store.is_pinned(shared.cid)).toBe(true)
    expect(await store.evict(shared.cid)).toBe(false)
    await store.unpin(blobs[0] as string)
    expect(await store.is_pinned(shared.cid)).toBe(false)
    expect(await store.evict(shared.cid)).toBe(true)
  })
})
