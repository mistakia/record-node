// The entry block cache's layout: a library's blocks load in the order they
// were written, through the library index, so a cold open reads the file
// forward. An index written while entry_blocks was keyed by hash migrates in
// place at open, and keeps its verified marks, so the watermark still holds.

import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { create_library_manager } from '#peer/library.ts'
import { create_memory_state_store } from '#peer/state.ts'
import { create_entry_block_cache } from '#query-db/entry-blocks.ts'
import { create_projector } from '#query-db/projector.ts'
import { open_query_db } from '#query-db/schema.ts'
import { sign_raw, track_put } from '#test/helpers/library.ts'

const warnings = spyOn(process, 'emitWarning').mockImplementation(() => {})
afterAll(() => { warnings.mockRestore() })

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const index_path = () => {
  const dir = mkdtempSync(join(tmpdir(), 'entry-blocks-'))
  dirs.push(dir)
  return join(dir, 'index.sqlite')
}

// entry_blocks as index files written before it was a rowid table hold it.
const HASH_KEYED = `
  CREATE TABLE entry_blocks (
    library_address TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (library_address, entry_hash)
  ) WITHOUT ROWID`

// Rewrites a closed index file's entry_blocks into the hash-keyed table, rows
// and verified marks unchanged.
const rewrite_hash_keyed = (path: string) => {
  const db = open_query_db({ path })
  db.exec('ALTER TABLE entry_blocks RENAME TO entry_blocks_current')
  db.exec(HASH_KEYED)
  db.exec('INSERT INTO entry_blocks SELECT library_address, entry_hash, bytes FROM entry_blocks_current')
  db.exec('DROP TABLE entry_blocks_current')
  db.close()
}

const table_sql = (db: ReturnType<typeof open_query_db>) =>
  (db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'entry_blocks'").get() as { sql: string }).sql

const block = (text: string) => new TextEncoder().encode(text)

describe('entry block cache layout', () => {
  test('a library\'s blocks load in the order they were written, through the library index', () => {
    const db = open_query_db()
    const cache = create_entry_block_cache(db)
    const written = ['zz', 'aa', 'mm', 'bb'].map((hash) => ({ hash, bytes: block(hash) }))
    cache.save({ library_address: 'one', entries: written.slice(0, 2), heads: ['aa'] })
    cache.save({ library_address: 'two', entries: [{ hash: 'cc', bytes: block('cc') }], heads: ['cc'] })
    cache.save({ library_address: 'one', entries: written.slice(2), heads: ['bb'] })
    cache.save({ library_address: 'one', entries: [written[0]!], heads: ['bb'] })
    expect(cache.load('one').blocks).toEqual(written.map(({ bytes }) => bytes))

    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT bytes FROM entry_blocks INDEXED BY entry_blocks_by_library WHERE library_address = ? ORDER BY rowid')
      .all('one') as Array<{ detail: string }>
    const details = plan.map(({ detail }) => detail).join('\n')
    expect(details).toContain('USING INDEX entry_blocks_by_library')
    expect(details).not.toContain('TEMP B-TREE')
    expect(table_sql(db)).not.toMatch(/WITHOUT ROWID/i)
  })

  test('an index with hash-keyed entry blocks migrates in place, keeping blocks and verified marks', () => {
    const path = index_path()
    const before = open_query_db({ path })
    const cache = create_entry_block_cache(before)
    cache.save({ library_address: 'one', entries: ['bb', 'aa'].map((hash) => ({ hash, bytes: block(hash) })), heads: ['bb'] })
    cache.save({ library_address: 'two', entries: [{ hash: 'cc', bytes: block('cc') }], heads: ['cc'] })
    before.close()
    rewrite_hash_keyed(path)

    const db = open_query_db({ path })
    expect(table_sql(db)).not.toMatch(/WITHOUT ROWID/i)
    const migrated = create_entry_block_cache(db)
    expect(migrated.load('one')).toEqual({ blocks: [block('aa'), block('bb')], verified_heads: ['bb'] })
    expect(migrated.load('two')).toEqual({ blocks: [block('cc')], verified_heads: ['cc'] })
    migrated.save({ library_address: 'one', entries: [{ hash: 'aa', bytes: block('aa') }, { hash: '00', bytes: block('00') }], heads: ['00'] })
    expect(migrated.load('one').blocks).toEqual([block('aa'), block('bb'), block('00')])
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'entry_blocks_by_hash'").get()).toEqual({ n: 0 })
    db.close()
  })

  test('a failed copy drops only the entry block cache', () => {
    const path = index_path()
    const before = open_query_db({ path })
    create_entry_block_cache(before).save({ library_address: 'one', entries: [{ hash: 'aa', bytes: block('aa') }], heads: ['aa'] })
    before.prepare("INSERT INTO library_heads (library_address, heads, pending) VALUES ('one', '[\"aa\"]', '[]')").run()
    before.close()
    rewrite_hash_keyed(path)
    // The copy's rename to entry_blocks_by_hash now fails.
    const blocker = new DatabaseSync(path)
    blocker.exec('CREATE VIEW entry_blocks_by_hash AS SELECT 1')
    blocker.close()

    const db = open_query_db({ path })
    expect(table_sql(db)).not.toMatch(/WITHOUT ROWID/i)
    expect(create_entry_block_cache(db).load('one')).toEqual({ blocks: [], verified_heads: undefined })
    expect(db.prepare('SELECT library_address FROM library_heads').all()).toEqual([{ library_address: 'one' }])
    db.close()
  })

  // A planted entry signed by a key outside the write list, recorded as
  // verified, survives only a restore: verification rejects it.
  test('an open over a migrated index restores the cache without verifying it again', async () => {
    const path = index_path()
    const content_store = create_memory_content_store()
    const state_store = create_memory_state_store()
    const manager_over = (db: ReturnType<typeof open_query_db>) => create_library_manager({
      content_store,
      projector: create_projector({ db, read_content: content_store.get }),
      entry_blocks: create_entry_block_cache(db),
      state_store
    })

    const before = open_query_db({ path })
    const writer = generate_key_pair()
    const manager = manager_over(before)
    const { chain } = await manager.create_library({ name: 'migrated', type: 'recordstore', write_keys: [writer.public_key] })
    const honest = await manager.append({ library_address: chain.address, payload: track_put({ fingerprint: 'AQAA-honest' }), key_pair: writer })
    const stranger = generate_key_pair()
    const planted = sign_raw({
      private_key: stranger.private_key,
      fields: {
        id: chain.address,
        payload: track_put({ fingerprint: 'AQAA-planted' }),
        next: [honest.hash],
        clock: { id: stranger.public_key, time: honest.entry.clock.time + 1 }
      }
    })
    await content_store.put(planted.hash, planted.bytes)
    create_entry_block_cache(before).save({ library_address: chain.address, entries: [planted], heads: [planted.hash] })
    await state_store.save_heads({ library_address: chain.address, heads: [planted.hash] })
    before.close()
    rewrite_hash_keyed(path)

    const db = open_query_db({ path })
    const { oplog } = await manager_over(db).open_library(chain.address)
    expect(oplog.entries.has(planted.hash)).toBe(true)
    expect([...oplog.heads]).toEqual([planted.hash])
    db.close()
  })
})
