// The entry block cache's layout: a library's blocks load in the order they
// were written, through the library index, so a cold open reads the file
// forward.

import { describe, expect, test } from 'bun:test'

import { create_entry_block_cache } from '#query-db/entry-blocks.ts'
import { open_query_db } from '#query-db/schema.ts'

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
})
