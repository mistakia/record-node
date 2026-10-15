// A label-filtered page is read by one of two plans, sorting every match or
// walking the sort's index and probing each row's labels, chosen by how far
// the walk would read. Both must give the same page: every page here is
// checked against the matches computed directly, across filters broad enough
// to walk and narrow or deep enough to sort, in one library and in all.

import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { list_tracks } from '#query-db/queries.ts'
import { open_query_db } from '#query-db/schema.ts'

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
  const tag = db.prepare('INSERT INTO tags (library_address, track_id, tag) VALUES (?, ?, ?)')
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
          const page = list_tracks({ db, library_addresses: scope, ...filter, sort, order: 'desc', offset: Math.max(0, offset), limit: 50 })
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
  const tag = db.prepare('INSERT INTO tags (library_address, track_id, tag) VALUES (?, ?, ?)')
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
