// The open's verification watermark: cached entry blocks last written at the
// persisted heads under the current verification rules are restored without
// verifying each entry again, and any other cache is verified in full.
//
// A planted entry signed by a key outside the write list separates the two:
// only a restore keeps it, since verification rejects it at authorisation.

import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'

import { create_ac_chain } from '#access-control/create.ts'
import { resolve_ac_chain } from '#access-control/resolve.ts'
import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair, type KeyPair } from '#identity/key-pair.ts'
import { VERIFICATION_RULES_VERSION } from '#oplog/accept.ts'
import { create_oplog, type Oplog } from '#oplog/dag.ts'
import { merge_entries, restore_entries } from '#oplog/merge.ts'
import { create_entry_block_cache } from '#query-db/entry-blocks.ts'
import type { LibraryType } from '#types/library.ts'
import { build_capability_vector, LIBRARY_ADDRESSES, OWNER_KEY } from '#test/conformance/capability-vector.ts'
import { sign_raw, track_put } from '#test/helpers/library.ts'
import { open_library_manager } from '#test/helpers/library-manager.ts'
import { create_memory_block_store } from '#test/helpers/memory-block-store.ts'

const warnings = spyOn(process, 'emitWarning').mockImplementation(() => {})
afterEach(() => { warnings.mockClear() })
afterAll(() => { warnings.mockRestore() })

const verified_row = (db: ReturnType<typeof open_library_manager>['db'], library_address: string) =>
  db.prepare('SELECT heads, rules_version FROM entry_blocks_verified WHERE library_address = ?').get(library_address) as
    { heads: string, rules_version: number } | undefined

// A payload either library type accepts from its writer.
const payload_for = (type: LibraryType, name: string) => type === 'listens'
  ? { trackId: compute_track_id(name), address: LIBRARY_ADDRESSES.recordstore, timestamp: 1700000000000 }
  : track_put({ fingerprint: name })

const signed = ({ key_pair, library_address, type, name, oplog, next }: {
  key_pair: KeyPair
  library_address: string
  type: LibraryType
  name: string
  oplog: Oplog
  next: string
}) => sign_raw({
  private_key: key_pair.private_key,
  fields: {
    id: library_address,
    payload: payload_for(type, name),
    next: [next],
    clock: { id: key_pair.public_key, time: (oplog.entries.get(next)?.entry.clock.time ?? 0) + 1 }
  }
})

// One honest entry, then the planted entry recorded as verified at the heads
// it makes, in the cache and the persisted heads alike, as if an earlier run
// had accepted it. The planted block is in the store too, so a walk finds it.
const plant = async ({ type = 'recordstore' }: { type?: 'recordstore' | 'listens' } = {}) => {
  const opened = open_library_manager()
  const { content_store, db, state_store, manager } = opened
  const writer = generate_key_pair()
  const { chain, oplog } = await manager.create_library({ name: 'watermark', type, write_keys: [writer.public_key] })
  const honest = (await manager.append({ library_address: chain.address, payload: payload_for(type, 'AQAA-honest'), key_pair: writer })).hash
  const planted = signed({ key_pair: generate_key_pair(), library_address: chain.address, type, name: 'AQAA-planted', oplog, next: honest })
  await content_store.put(planted.hash, planted.bytes)
  create_entry_block_cache({ db }).save({ library_address: chain.address, entries: [planted], heads: [planted.hash] })
  await state_store.save_heads({ library_address: chain.address, heads: [planted.hash] })
  return { ...opened, writer, oplog, library_address: chain.address, honest, planted: planted.hash }
}

const derived_state = (oplog: Oplog) => ({
  entries: [...oplog.entries.keys()].sort(),
  heads: [...oplog.heads].sort(),
  current: [...oplog.current].map(([key, { hash }]) => [key, hash]).sort(),
  capabilities: [...oplog.capabilities.keys()].sort(),
  revocations: [...oplog.revocations.keys()].sort(),
  delegated: [...oplog.delegated].sort(),
  effective: [...oplog.effective].sort(),
  inert: [...oplog.inert].sort()
})

describe('open verification watermark', () => {
  test('appends record the oplog heads as verified under the current rules', async () => {
    const { db, manager } = open_library_manager()
    const writer = generate_key_pair()
    const { chain, oplog } = await manager.create_library({ name: 'appends', type: 'recordstore', write_keys: [writer.public_key] })
    await manager.append({ library_address: chain.address, payload: track_put({ fingerprint: 'AQAA-a' }), key_pair: writer })
    expect(verified_row(db, chain.address)).toEqual({ heads: JSON.stringify([...oplog.heads]), rules_version: VERIFICATION_RULES_VERSION })
  })

  for (const type of ['recordstore', 'listens'] as const) {
    test(`a ${type} cache at the verified heads under the same rules is restored without verifying`, async () => {
      const { reopen, library_address, honest, planted } = await plant({ type })
      const { oplog } = await reopen().open_library(library_address)
      expect([...oplog.entries.keys()].sort()).toEqual([honest, planted].sort())
      expect([...oplog.heads]).toEqual([planted])
      expect(warnings).not.toHaveBeenCalled()
    })
  }

  test('restore derives the same access and current state as full verification', async () => {
    // The F10 capability vector: capabilities, grantee writes, revocations,
    // and inert entries in all three library types.
    const { cases } = build_capability_vector()
    const block_store = create_memory_block_store()
    for (const [type, name] of [['recordstore', 'library'], ['listens', 'listens'], ['identity', 'identity']] as const) {
      const { address } = await create_ac_chain({ name, type, write_keys: [OWNER_KEY.public_key], block_store })
      const chain = await resolve_ac_chain({ library_address: address, block_store })
      const verified = create_oplog({ chain })
      merge_entries({ oplog: verified, blocks: cases.filter(({ library }) => library === type).map(({ hashed }) => hashed.bytes) })
      const restored = create_oplog({ chain })
      const { rejected } = restore_entries({ oplog: restored, blocks: [...verified.entries.values()].map(({ bytes }) => bytes).reverse() })
      expect(rejected).toEqual([])
      expect(derived_state(restored)).toEqual(derived_state(verified))
    }
    expect(cases.some(({ verdict }) => verdict === 'inert')).toBe(true)
  })

  test('a rules version change verifies every cached entry again', async () => {
    const { db, reopen, library_address, honest } = await plant()
    db.prepare('UPDATE entry_blocks_verified SET rules_version = ?').run(VERIFICATION_RULES_VERSION - 1)
    const { oplog } = await reopen().open_library(library_address)
    expect([...oplog.entries.keys()]).toEqual([honest])
    expect(String(warnings.mock.calls[0]?.[0])).toContain('failed verification at open')
    // The walk recached what verified, under the current rules.
    expect(verified_row(db, library_address)).toEqual({ heads: JSON.stringify([honest]), rules_version: VERIFICATION_RULES_VERSION })
  })

  test('a cache whose verified heads differ from the persisted heads is verified in full', async () => {
    const { db, reopen, library_address, honest } = await plant()
    // As when blocks were cached past the watermark, by a version that kept none.
    db.prepare('UPDATE entry_blocks_verified SET heads = ?').run(JSON.stringify([honest]))
    const { oplog } = await reopen().open_library(library_address)
    expect([...oplog.entries.keys()]).toEqual([honest])
    expect(warnings).toHaveBeenCalledTimes(1)
  })

  test('a cache saved past the persisted heads before a crash opens at the persisted heads', async () => {
    const { db, manager, reopen } = open_library_manager()
    const writer = generate_key_pair()
    const { chain, oplog } = await manager.create_library({ name: 'crash', type: 'recordstore', write_keys: [writer.public_key] })
    const library_address = chain.address
    const head = (await manager.append({ library_address, payload: track_put({ fingerprint: 'AQAA-head' }), key_pair: writer })).hash
    // register cached a writer's entry and its heads, then the process died
    // before the heads were persisted.
    const ahead = signed({ key_pair: writer, library_address, type: 'recordstore', name: 'AQAA-ahead', oplog, next: head })
    create_entry_block_cache({ db }).save({ library_address, entries: [ahead], heads: [ahead.hash] })
    const reopened = await reopen().open_library(library_address)
    expect([...reopened.oplog.entries.keys()]).toEqual([head])
    expect(warnings).not.toHaveBeenCalled()
  })

  test('a cache with no watermark is verified in full and marked verified', async () => {
    const { db, manager, reopen } = open_library_manager()
    const writer = generate_key_pair()
    const { chain } = await manager.create_library({ name: 'upgrade', type: 'recordstore', write_keys: [writer.public_key] })
    for (const fingerprint of ['AQAA-u1', 'AQAA-u2']) {
      await manager.append({ library_address: chain.address, payload: track_put({ fingerprint }), key_pair: writer })
    }
    // As an index written before the watermark existed.
    db.prepare('DELETE FROM entry_blocks_verified').run()
    const { oplog } = await reopen().open_library(chain.address)
    expect(oplog.entries.size).toBe(2)
    expect(verified_row(db, chain.address)).toEqual({ heads: JSON.stringify([...oplog.heads]), rules_version: VERIFICATION_RULES_VERSION })
  })

  test('a restored cache with a gap is replaced by a walk', async () => {
    const { db, reopen, library_address, honest, planted } = await plant()
    db.prepare('DELETE FROM entry_blocks WHERE entry_hash = ?').run(honest)
    // The walk verifies what it reads, so the planted entry is rejected.
    const { oplog } = await reopen().open_library(library_address)
    expect([...oplog.entries.keys()]).toEqual([honest])
    expect(oplog.entries.has(planted)).toBe(false)
  })

  test('unlink forgets the watermark', async () => {
    const { db, manager, library_address } = await plant()
    await manager.unlink_library(library_address)
    expect(verified_row(db, library_address)).toBeUndefined()
  })
})
