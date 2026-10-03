// Entry version, pinning, and query database (§4.1.1, §4.6, §4.7).
// §4.1.1 runs against src/entry and src/oplog, §4.6 against the library
// lifecycle in src/peer, and §4.7 against src/query-db.

import { describe, expect, test } from 'bun:test'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { decode_signed_entry } from '#entry/signed.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_listen } from '#oplog/listens.ts'
import { create_oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { create_projector } from '#query-db/projector.ts'
import { rebuild_query_db } from '#query-db/rebuild.ts'
import { open_query_db } from '#query-db/schema.ts'
import { append_track, blocks_of, open_test_library } from '#test/helpers/library.ts'
import { append_stored_track, open_library_manager, pinned, write_chain } from '#test/helpers/library-manager.ts'
import {
  add_link,
  add_track,
  delete_track,
  dump_query_db,
  in_batches,
  jittered_reader,
  set_about,
  shuffled
} from '#test/query-db/fixtures.ts'

const current_rows = (db: ReturnType<typeof open_query_db>) =>
  db.prepare('SELECT key, entry_hash FROM entries ORDER BY key').all().map(({ key, entry_hash }) => [key, entry_hash])

describe('library-structure', () => {
  test('§4.1.1 [MUST] signed entry v is 2', async () => {
    const writer = generate_key_pair()
    const { oplog } = await open_test_library({ writers: [writer] })
    const { entry, bytes } = append_track({ oplog, key_pair: writer })
    expect(entry.v).toBe(2)
    expect(decode_signed_entry(bytes).entry.v).toBe(2)
    expect(() => decode_signed_entry(encode_canonical({ ...entry, v: 1 }))).toThrow('entry v must be 2')
  })
  test('§4.6 [MUST] AC chain objects are pinned for each opened library', async () => {
    const { content_store, manager } = open_library_manager()
    const chains = [await write_chain({ content_store, name: 'one', writer: generate_key_pair() }), await write_chain({ content_store, name: 'two', writer: generate_key_pair() })]
    const cids = chains.flatMap(({ cids }) => [cids.manifest, cids.wrapper, cids.write_list])
    expect(await pinned(content_store, cids)).toEqual(cids.map(() => false))
    for (const { address } of chains) await manager.open_library(address)
    expect(await pinned(content_store, cids)).toEqual(cids.map(() => true))
  })

  test('§4.6 [MUST] unlink unpins the AC chain objects', async () => {
    const { content_store, manager } = open_library_manager()
    const kept = await manager.create_library({ name: 'kept', type: 'recordstore', write_keys: [generate_key_pair().public_key] })
    const gone = await manager.create_library({ name: 'gone', type: 'recordstore', write_keys: [generate_key_pair().public_key] })
    const chain_cids = ({ chain: { cids } }: typeof kept) => [cids.manifest, cids.wrapper, cids.write_list]
    await manager.unlink_library(gone.chain.address)
    expect(await pinned(content_store, chain_cids(gone))).toEqual([false, false, false])
    expect(await pinned(content_store, chain_cids(kept))).toEqual([true, true, true])
    expect(manager.get(gone.chain.address)).toBeUndefined()
  })

  test('§4.6 [MUST] unlink unpins entry objects only this library held', async () => {
    const { content_store, manager, db } = open_library_manager()
    const writer = generate_key_pair()
    const [kept, gone] = [await manager.create_library({ name: 'kept', type: 'recordstore', write_keys: [writer.public_key] }),
      await manager.create_library({ name: 'gone', type: 'recordstore', write_keys: [writer.public_key] })]
    const write = async (library_address: string, fingerprint: string) =>
      await append_stored_track({ manager, content_store, library_address, key_pair: writer, fingerprint, audio: fingerprint })
    const kept_entry = (await write(kept.chain.address, 'AQAA-kept')).entry_hash
    const gone_entries = [(await write(gone.chain.address, 'AQAA-gone-1')).entry_hash, (await write(gone.chain.address, 'AQAA-gone-2')).entry_hash]
    expect(await pinned(content_store, [kept_entry, ...gone_entries])).toEqual([true, true, true])
    await manager.unlink_library(gone.chain.address)
    expect(await pinned(content_store, gone_entries)).toEqual([false, false])
    expect(await pinned(content_store, [kept_entry])).toEqual([true])
    // The index forgets the unlinked library too (§4.7).
    expect(db.prepare('SELECT DISTINCT library_address FROM entries').all()).toEqual([{ library_address: kept.chain.address }])
  })

  test('§4.6 [MUST] unlink unpins content no other linked library references and keeps shared content', async () => {
    const { content_store, manager } = open_library_manager()
    const writer = generate_key_pair()
    const [kept, gone] = [await manager.create_library({ name: 'kept', type: 'recordstore', write_keys: [writer.public_key] }),
      await manager.create_library({ name: 'gone', type: 'recordstore', write_keys: [writer.public_key] })]
    const write = async (library_address: string, fingerprint: string) =>
      await append_stored_track({ manager, content_store, library_address, key_pair: writer, fingerprint, audio: `audio of ${fingerprint}` })
    const shared = await write(kept.chain.address, 'AQAA-shared')
    expect(await write(gone.chain.address, 'AQAA-shared')).toMatchObject({ content_cid: shared.content_cid, audio_cid: shared.audio_cid })
    const unique = await write(gone.chain.address, 'AQAA-unique')
    await manager.unlink_library(gone.chain.address)
    expect(await pinned(content_store, [shared.content_cid, shared.audio_cid])).toEqual([true, true])
    expect(await pinned(content_store, [unique.content_cid, unique.audio_cid])).toEqual([false, false])
  })

  test('§4.7 [MUST] the query database is fully derivable from the oplog', async () => {
    const writer = generate_key_pair()
    const { oplog, block_store } = await open_test_library({ writers: [writer] })
    const listens = await open_test_library({ name: 'listens', type: 'listens', writers: [writer] })
    const db = open_query_db()
    const projector = create_projector({ db, read_content: block_store.get })
    const project = (entry: ReturnType<typeof append_track>) => projector.project_append({ oplog, entry })

    const first = await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-one', title: 'One', timestamp: 100 })
    await project(first)
    await project(await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-two', title: 'Two', tags: ['dub'] }))
    await project(await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-one', title: 'One', tags: ['late'] }))
    await project(await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-gone' }))
    const gone = oplog.entries.get([...oplog.heads][0] as string)
    await project(delete_track({ oplog, key_pair: writer, key: (gone?.operation as { key: string }).key }))
    await project(await add_link({ oplog, key_pair: writer, block_store, address: listens.chain.address, alias: 'mine' }))
    await project(await set_about({ oplog, key_pair: writer, block_store, profile: { name: 'Library' } }))
    for (const time of [1, 2, 3]) {
      const entry = append_listen({ oplog: listens.oplog, track_id: 'a'.repeat(64), address: oplog.chain.address, key_pair: writer, timestamp: time })
      await projector.project_append({ oplog: listens.oplog, entry })
    }

    const rebuilt = open_query_db()
    const { oplogs, rejected } = await rebuild_query_db({
      db: rebuilt,
      read_content: block_store.get,
      libraries: [
        { chain: oplog.chain, blocks: blocks_of(oplog) },
        { chain: listens.chain, blocks: blocks_of(listens.oplog) }
      ]
    })
    expect(rejected).toEqual([])
    expect(oplogs.map(({ entries }) => entries.size)).toEqual([oplog.entries.size, listens.oplog.entries.size])
    expect(dump_query_db(rebuilt)).toEqual(dump_query_db(db))
    // The projection holds the oplog's resolution of every key, tombstones included.
    expect(current_rows(db)).toEqual([...oplog.current].map(([key, entry]) => [key, entry.hash]).sort())
    expect(db.prepare('SELECT count(*) AS count FROM tracks').get()?.count).toBe(2)
    expect(db.prepare('SELECT count(*) AS count FROM listens').get()?.count).toBe(3)
  })

  test('§4.7 [MUST] rebuilding the query database equals incremental maintenance', async () => {
    const [alice, bob] = [generate_key_pair(), generate_key_pair()]
    const { chain, block_store } = await open_test_library({ writers: [alice, bob] })
    // Two writers edit the same keys without exchanging entries, so the merge
    // must resolve concurrent PUTs and DELs by clock, timestamp, and hash.
    const alice_log = create_oplog({ chain })
    const bob_log = create_oplog({ chain })
    const fingerprints = ['AQAA-a', 'AQAA-b', 'AQAA-c', 'AQAA-d', 'AQAA-e', 'AQAA-f']
    for (const [index, fingerprint] of fingerprints.entries()) {
      await add_track({ oplog: alice_log, key_pair: alice, block_store, fingerprint, title: `alice ${index}`, timestamp: 1000 + index, tags: ['alice'] })
      await add_track({ oplog: bob_log, key_pair: bob, block_store, fingerprint, title: `bob ${index}`, timestamp: 1000 + (index % 2) * 5, tags: ['bob'] })
    }
    for (const key of [...alice_log.current.keys()].slice(0, 2)) delete_track({ oplog: alice_log, key_pair: alice, key, timestamp: 2000 })
    await add_track({ oplog: bob_log, key_pair: bob, block_store, fingerprint: 'AQAA-a', title: 'bob relabel', tags: ['again'], timestamp: 2000 })
    await add_track({ oplog: bob_log, key_pair: bob, block_store, fingerprint: 'AQAA-z', title: 'not stored', store: false })
    const blocks = [...blocks_of(alice_log), ...blocks_of(bob_log)]

    const rebuilt = open_query_db()
    await rebuild_query_db({ db: rebuilt, read_content: block_store.get, libraries: [{ chain, blocks }] })
    expect(rebuilt.prepare("SELECT count(*) AS count FROM entries WHERE op = 'DEL'").get()?.count).toBeGreaterThan(0)
    expect(rebuilt.prepare('SELECT count(*) AS count FROM tracks').get()?.count).toBeGreaterThan(4)

    for (const seed of [1, 7, 42]) {
      const oplog = create_oplog({ chain })
      const db = open_query_db()
      const projector = create_projector({ db, read_content: jittered_reader(block_store) })
      // Batches merge while earlier batches are still loading content, so
      // per-batch projection runs concurrently with later merges (§4.5).
      const projections = []
      for (const batch of in_batches(shuffled(blocks, seed), 3)) {
        const result = merge_entries({ oplog, blocks: batch })
        projections.push(projector.project_merge({ oplog, result }))
        await new Promise((resolve) => setTimeout(resolve, seed % 3))
      }
      await Promise.all(projections)
      expect(dump_query_db(db)).toEqual(dump_query_db(rebuilt))
      expect(current_rows(db)).toEqual([...oplog.current].map(([key, entry]) => [key, entry.hash]).sort())
    }
  })
})
