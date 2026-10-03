// The read side the HTTP API routes need: GET /tracks filters, sorts, and
// pages; GET /tags counts; GET /listens history.

import { beforeAll, describe, expect, test } from 'bun:test'
import type { DatabaseSync } from 'node:sqlite'

import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_listen } from '#oplog/listens.ts'
import { create_projector } from '#query-db/projector.ts'
import { get_track, list_listens, list_tags, list_tracks } from '#query-db/queries.ts'
import { open_query_db } from '#query-db/schema.ts'
import { open_test_library } from '#test/helpers/library.ts'
import { add_track } from './fixtures.ts'

let db: DatabaseSync
let own: string
let friend: string

const ids = (items: readonly { id: string }[]) => items.map(({ id }) => id)
const id_of = (fingerprint: string) => compute_track_id(fingerprint)

// Own library: alpha, beta, gamma. Friend library: gamma (shared, different
// title) and delta (100% off), plus tags from both sides.
beforeAll(async () => {
  const writer = generate_key_pair()
  const mine = await open_test_library({ name: 'mine', writers: [writer] })
  const theirs = await open_test_library({ name: 'theirs', writers: [writer] })
  const listens = await open_test_library({ name: 'listens', type: 'listens', writers: [writer] })
  own = mine.chain.address
  friend = theirs.chain.address
  db = open_query_db()
  const block_store = mine.block_store
  const projector = create_projector({ db, read_content: block_store.get })
  const tracks = [
    { oplog: mine.oplog, fingerprint: 'alpha', title: 'Alpha', artist: 'Zed', bpm: 120, audio: { duration: 200 }, tags: ['house', 'deep'], timestamp: 1 },
    { oplog: mine.oplog, fingerprint: 'beta', title: 'beta', artist: 'Yan', album: 'Night Album', bpm: 90, tags: ['house'], timestamp: 2 },
    { oplog: mine.oplog, fingerprint: 'gamma', title: 'Gamma', artist: 'Xu', remixer: 'Night Remixer', audio: { duration: 100 }, tags: ['deep'], timestamp: 3 },
    { oplog: theirs.oplog, fingerprint: 'gamma', title: 'Gamma (theirs)', artist: 'Xu', tags: ['house'], timestamp: 4 },
    { oplog: theirs.oplog, fingerprint: 'delta', title: '100% off', artist: 'Wu', bpm: 128, tags: ['techno'], timestamp: 5 }
  ]
  for (const { oplog, ...track } of tracks) {
    await projector.project_append({ oplog, entry: await add_track({ oplog, key_pair: writer, block_store, ...track }) })
  }
  const plays: [string, number][] = [['alpha', 10], ['gamma', 30], ['alpha', 40], ['unknown', 20]]
  for (const [fingerprint, timestamp] of plays) {
    const track_id = fingerprint === 'unknown' ? 'f'.repeat(64) : id_of(fingerprint)
    const entry = append_listen({ oplog: listens.oplog, track_id, address: own, key_pair: writer, timestamp })
    await projector.project_append({ oplog: listens.oplog, entry })
  }
})

describe('query-db list_tracks', () => {
  test('defaults to newest first, one item per track id, own library preferred', () => {
    const { items, total } = list_tracks({ db, own_library_address: own })
    expect(total).toBe(4)
    expect(ids(items)).toEqual(['delta', 'gamma', 'beta', 'alpha'].map(id_of))
    const gamma = items.find(({ id }) => id === id_of('gamma'))
    expect(gamma).toMatchObject({ title: 'Gamma', library_address: own, have_track: true, listen_count: 1 })
    expect(gamma?.tags).toEqual([{ library_address: own, tag: 'deep' }, { library_address: friend, tag: 'house' }]
      // Byte order, as SQLite orders the rows; localeCompare folds case.
      .sort((a, b) => (a.library_address < b.library_address ? -1 : a.library_address > b.library_address ? 1 : 0)))
    expect(items.find(({ id }) => id === id_of('delta'))?.have_track).toBe(false)
    expect(gamma?.listen_timestamps_ms).toBeUndefined()
  })

  test('library_addresses scopes rows and tags', () => {
    const { items, total } = list_tracks({ db, own_library_address: own, library_addresses: [friend] })
    expect(total).toBe(2)
    const gamma = items.find(({ id }) => id === id_of('gamma'))
    expect(gamma).toMatchObject({ title: 'Gamma (theirs)', library_address: friend, have_track: true })
    expect(gamma?.tags).toEqual([{ library_address: friend, tag: 'house' }])
  })

  test('tags match with AND semantics within the scope', () => {
    expect(ids(list_tracks({ db, tags: ['house', 'deep'], sort: 'title', order: 'asc' }).items)).toEqual(['alpha', 'gamma'].map(id_of))
    expect(list_tracks({ db, tags: ['house', 'deep'], library_addresses: [own] }).total).toBe(1)
    expect(list_tracks({ db, tags: ['house', 'missing'] }).total).toBe(0)
  })

  test('query searches title, artist, album, and remixer, with LIKE wildcards escaped', () => {
    expect(ids(list_tracks({ db, own_library_address: own, query: 'night', sort: 'title', order: 'asc' }).items)).toEqual(['beta', 'gamma'].map(id_of))
    expect(ids(list_tracks({ db, query: 'zed' }).items)).toEqual([id_of('alpha')])
    expect(ids(list_tracks({ db, query: '100%' }).items)).toEqual([id_of('delta')])
    expect(list_tracks({ db, query: '_' }).total).toBe(0)
  })

  test('sorts by whitelisted fields with nulls last, and pages with an unpaginated total', () => {
    expect(ids(list_tracks({ db, own_library_address: own, sort: 'bpm', order: 'asc' }).items)).toEqual(['beta', 'alpha', 'delta', 'gamma'].map(id_of))
    expect(ids(list_tracks({ db, own_library_address: own, sort: 'bpm', order: 'desc' }).items)).toEqual(['delta', 'alpha', 'beta', 'gamma'].map(id_of))
    expect(ids(list_tracks({ db, own_library_address: own, sort: 'duration', order: 'asc' }).items).slice(0, 2)).toEqual(['gamma', 'alpha'].map(id_of))
    expect(ids(list_tracks({ db, own_library_address: own, sort: 'title', order: 'asc' }).items)).toEqual(['delta', 'alpha', 'beta', 'gamma'].map(id_of))
    const page = list_tracks({ db, sort: 'added_at', order: 'asc', offset: 1, limit: 2 })
    expect(page).toMatchObject({ total: 4 })
    expect(ids(page.items)).toEqual(['beta', 'gamma'].map(id_of))
    expect(list_tracks({ db, offset: 10 })).toEqual({ items: [], total: 4 })
    expect(list_tracks({ db, shuffle: true }).items).toHaveLength(4)
  })

  test('rejects out-of-range paging and unlisted sorts', () => {
    expect(() => list_tracks({ db, limit: 0 })).toThrow(RangeError)
    expect(() => list_tracks({ db, limit: 501 })).toThrow(RangeError)
    expect(() => list_tracks({ db, offset: -1 })).toThrow(RangeError)
    expect(() => list_tracks({ db, sort: 'title; DROP TABLE tracks' as never })).toThrow(RangeError)
  })
})

describe('query-db tags and listens', () => {
  test('list_tags counts distinct tracks per tag in the scope', () => {
    expect(list_tags({ db })).toEqual([{ tag: 'house', count: 3 }, { tag: 'deep', count: 2 }, { tag: 'techno', count: 1 }])
    expect(list_tags({ db, library_addresses: [own] })).toEqual([{ tag: 'deep', count: 2 }, { tag: 'house', count: 2 }])
  })

  test('get_track carries listen timestamps, newest first', () => {
    expect(get_track({ db, track_id: id_of('alpha') })).toMatchObject({ listen_count: 2, listen_timestamps_ms: [40, 10] })
    expect(get_track({ db, track_id: 'e'.repeat(64) })).toBeUndefined()
  })

  test('list_listens orders by most recent listen and pages', () => {
    const { items, total } = list_listens({ db, own_library_address: own })
    expect(total).toBe(3)
    expect(items.map(({ track_id, count, timestamps_ms, last_listened_at_ms }) => ({ track_id, count, timestamps_ms, last_listened_at_ms }))).toEqual([
      { track_id: id_of('alpha'), count: 2, timestamps_ms: [40, 10], last_listened_at_ms: 40 },
      { track_id: id_of('gamma'), count: 1, timestamps_ms: [30], last_listened_at_ms: 30 },
      { track_id: 'f'.repeat(64), count: 1, timestamps_ms: [20], last_listened_at_ms: 20 }
    ])
    expect(items[0]?.track).toMatchObject({ title: 'Alpha', have_track: true })
    expect(items[2]?.track).toBeUndefined()
    expect(list_listens({ db, offset: 1, limit: 1 }).items.map(({ track_id }) => track_id)).toEqual([id_of('gamma')])
    expect(list_listens({ db, listens_addresses: ['/record/none/none'] })).toEqual({ items: [], total: 0 })
  })
})
