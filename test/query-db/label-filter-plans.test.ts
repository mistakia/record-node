// A label-filtered page is read by one of two plans, sorting every match or
// walking the sort's index and probing each row's labels, chosen by how far
// the walk would read. Both must give the same page: every page here is
// checked against the matches computed directly, across filters broad enough
// to walk and narrow or deep enough to sort, in one library and in all. No
// plan reads the whole tags table: every label read narrows by library and
// label, or by track id, so a node with a million label applications reads
// only the labels a query names.

import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

import { list_tags, list_tracks } from '#query-db/queries.ts'
import { open_query_db } from '#query-db/schema.ts'

// Every statement a read runs on db, with its parameters, as the SQLite
// query plan steps that read the tags table.
const tag_reads = (db: DatabaseSync, read: () => unknown): string[] => {
  const statements: Array<{ sql: string, parameters: Record<string, SQLInputValue> }> = []
  const prepare = db.prepare.bind(db)
  db.prepare = ((sql: string) => {
    const statement = prepare(sql)
    const record = (parameters: unknown) => { statements.push({ sql, parameters: (parameters ?? {}) as Record<string, SQLInputValue> }) }
    return new Proxy(statement, {
      get: (target, property) => property === 'all' || property === 'get'
        ? (...args: unknown[]) => {
            record(args[0])
            return (target[property] as (...args: unknown[]) => unknown).apply(target, args)
          }
        : Reflect.get(target, property)
    })
  }) as typeof db.prepare
  try {
    read()
  } finally {
    db.prepare = prepare
  }
  return statements.flatMap(({ sql, parameters }) => sql.includes('tags')
    ? (prepare(`EXPLAIN QUERY PLAN ${sql}`).all(parameters) as Array<{ detail: string }>).map(({ detail }) => detail).filter((detail) => /^(SCAN|SEARCH) (tags|g)\b/.test(detail))
    : [])
}

const LIBRARIES = ['/record/a/record', '/record/b/record']
const N = 3000
const labels_of = (index: number): string[] => [
  `tier/t${index % 4}`,
  `origin/o${index % 14}`,
  ...(index % 3 === 0 ? ['house'] : []),
  ...(index % 97 === 0 ? ['rare/r'] : [])
]

test('the walked and the sorted plan give the same pages', () => {
  const db = open_query_db()
  const track = db.prepare("INSERT INTO tracks (library_address, track_id, entry_hash, content_cid, title, added_at_ms) VALUES (?, ?, 'e', 'c', ?, ?)")
  const tag = db.prepare("INSERT INTO tags (library_address, track_id, tag, entry_hash) VALUES (?, ?, ?, 'e')")
  const rows = Array.from({ length: N }, (_, index) => ({
    library_address: LIBRARIES[index % 2] as string,
    track_id: createHash('sha256').update(String(index)).digest('hex'),
    // Some titles absent, so a title page also reads its null rows.
    title: index % 11 === 0 ? null : `Title ${(index * 7919) % N}`,
    added_at_ms: 1_000 + index,
    labels: labels_of(index)
  }))
  for (const row of rows) {
    track.run(row.library_address, row.track_id, row.title, row.added_at_ms)
    for (const label of row.labels) tag.run(row.library_address, row.track_id, label)
  }
  // Broad filters (one group, several, a tags group) walk on early pages;
  // narrow ones and deep pages sort.
  const filters: Array<{ tags?: string[], tag_groups?: string[][] }> = [
    { tag_groups: [['tier/t0', 'tier/t1']] },
    { tag_groups: [['tier/t0', 'tier/t1', 'tier/t2'], ['origin/o3', 'origin/o5', 'origin/o7', 'origin/o9', 'origin/o11', 'origin/o13', 'origin/o1']] },
    { tags: ['house'], tag_groups: [['tier/t0', 'tier/t1', 'tier/t3']] },
    { tag_groups: [['tier/t2']] },
    { tag_groups: [['rare/r']] }
  ]
  for (const scope of [undefined, [LIBRARIES[0] as string], LIBRARIES]) {
    for (const filter of filters) {
      const groups = [...(filter.tags ?? []).map((label) => [label]), ...(filter.tag_groups ?? [])]
      const matches = rows.filter((row) => (scope === undefined || scope.includes(row.library_address)) &&
        groups.every((group) => group.some((label) => row.labels.includes(label))))
      for (const sort of ['added_at', 'title'] as const) {
        // Title desc: non-null titles first, then the null ones by track id.
        const ordered = [...matches].sort(sort === 'added_at'
          ? (a, b) => b.added_at_ms - a.added_at_ms
          : (a, b) => (a.title === null ? 1 : 0) - (b.title === null ? 1 : 0) ||
            (b.title ?? '').localeCompare(a.title ?? '') || b.track_id.localeCompare(a.track_id))
        for (const offset of [0, 50, Math.floor(matches.length / 2), matches.length - 10]) {
          let page = list_tracks({ db, library_addresses: scope, ...filter, sort, order: 'desc', offset: Math.max(0, offset), limit: 50 })
          const reads = tag_reads(db, () => { page = list_tracks({ db, library_addresses: scope, label_libraries: LIBRARIES, ...filter, sort, order: 'desc', offset: Math.max(0, offset), limit: 50 }) })
          expect(reads.length).toBeGreaterThan(0)
          expect(reads.filter((detail) => detail.startsWith('SCAN'))).toEqual([])
          expect(page.total).toBe(matches.length)
          expect(page.items.map(({ id }) => id)).toEqual(ordered.slice(Math.max(0, offset), Math.max(0, offset) + 50).map(({ track_id }) => track_id))
        }
      }
    }
  }
  db.close()
})

test('a track id in two libraries turns the label plans off and keeps one representative', () => {
  const db = open_query_db()
  const track = db.prepare("INSERT INTO tracks (library_address, track_id, entry_hash, content_cid, title, added_at_ms) VALUES (?, ?, 'e', 'c', 't', ?)")
  const tag = db.prepare("INSERT INTO tags (library_address, track_id, tag, entry_hash) VALUES (?, ?, ?, 'e')")
  const id = (index: number) => createHash('sha256').update(String(index)).digest('hex')
  for (let index = 0; index < 400; index++) {
    track.run(LIBRARIES[0] as string, id(index), index)
    tag.run(LIBRARIES[0] as string, id(index), 'tier/t0')
  }
  // The same track in the second library, labelled only there.
  track.run(LIBRARIES[1] as string, id(7), 7)
  tag.run(LIBRARIES[1] as string, id(7), 'view/v')
  const page = list_tracks({ db, own_library_addresses: [LIBRARIES[0] as string], tag_groups: [['view/v']], limit: 50 })
  expect(page.total).toBe(1)
  expect(page.items.map(({ id: track_id }) => track_id)).toEqual([id(7)])
  expect(list_tracks({ db, own_library_addresses: [LIBRARIES[0] as string], tag_groups: [['tier/t0']], limit: 50 }).total).toBe(400)
  db.close()
})

test('label_libraries narrows every label read by an index, in filters, counts, and hydration', () => {
  const db = open_query_db()
  const track = db.prepare("INSERT INTO tracks (library_address, track_id, entry_hash, content_cid, title, added_at_ms) VALUES (?, ?, 'e', 'c', 't', ?)")
  const tag = db.prepare("INSERT INTO tags (library_address, track_id, tag, entry_hash) VALUES (?, ?, ?, 'e')")
  const labels_library = '/record/c/labels'
  const id = (index: number) => createHash('sha256').update(String(index)).digest('hex')
  for (let index = 0; index < 500; index++) {
    track.run(LIBRARIES[0] as string, id(index), index)
    tag.run(labels_library, id(index), `tier/t${index % 5}`)
    // A label on a track no library holds counts nowhere.
    tag.run(labels_library, id(index + 10_000), `tier/t${index % 5}`)
  }
  const scope = { library_addresses: [LIBRARIES[0] as string], label_libraries: [LIBRARIES[0] as string, labels_library] }
  for (const read of [
    () => list_tracks({ db, ...scope, tag_groups: [['tier/t0', 'tier/t1']], limit: 50 }),
    () => list_tracks({ db, ...scope, tag_groups: [['tier/t0']], offset: 80, limit: 50 }),
    () => list_tracks({ db, ...scope, limit: 50 }),
    () => list_tags({ db, ...scope }),
    () => list_tags({ db, ...scope, prefix: 'tier/t1' })
  ]) {
    const reads = tag_reads(db, read)
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((detail) => /^SEARCH (tags|g) USING (COVERING INDEX tags_by_(library_tag|track_id)|PRIMARY KEY)/.test(detail))).toBe(true)
  }
  expect(list_tracks({ db, ...scope, tag_groups: [['tier/t0', 'tier/t1']], limit: 50 }).total).toBe(200)
  expect(list_tags({ db, ...scope, prefix: 'tier/t1' })).toEqual([{ tag: 'tier/t1', count: 100 }])
  // Labels another library applies do not count when it is left out.
  expect(list_tags({ db, library_addresses: [LIBRARIES[0] as string], label_libraries: [LIBRARIES[0] as string] })).toEqual([])
  db.close()
})
