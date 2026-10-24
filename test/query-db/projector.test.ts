// Incremental projection of appends, label records, DELs, About records, and
// listens, and late-arriving content.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_listen } from '#oplog/listens.ts'
import { create_projector } from '#query-db/projector.ts'
import { get_about, get_library_summary, get_listen_count, get_track, list_tracks } from '#query-db/queries.ts'
import { open_query_db } from '#query-db/schema.ts'
import type { DatabaseSync } from 'node:sqlite'
import { open_test_library } from '#test/helpers/library.ts'
import { add_labels, add_track, delete_track, set_about, store_content, track_content } from './fixtures.ts'

// The summary computed from the rows themselves, which library_totals must match.
const scanned_summary = (db: DatabaseSync, library_address: string) => {
  const row = db.prepare(`
    SELECT
      (SELECT count(*) FROM tracks WHERE library_address = :a) AS track_count,
      (SELECT coalesce(sum(audio_size_bytes), 0) FROM tracks WHERE library_address = :a) AS audio_size_bytes,
      (SELECT count(*) FROM entries WHERE library_address = :a AND op = 'PUT') AS length`).get({ a: library_address }) ?? {}
  return {
    track_count: Number(row.track_count),
    audio_size_bytes: Number(row.audio_size_bytes),
    linked_library_count: 0,
    length: Number(row.length)
  }
}

const setup = async () => {
  const writer = generate_key_pair()
  const library = await open_test_library({ writers: [writer] })
  const db = open_query_db()
  const projector = create_projector({ db, read_content: library.block_store.get })
  return { ...library, writer, db, projector }
}

describe('query-db projector', () => {
  test('a PUT projects the envelope and its content payload', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const entry = await add_track({
      oplog,
      key_pair: writer,
      block_store,
      fingerprint: 'AQAA-track',
      title: 'Title',
      artist: 'Artist',
      artists: ['Artist', 'Guest'],
      album: 'Album',
      albumartist: 'Album Artist',
      bpm: 124,
      genre: ['house'],
      audio: { duration: 301.5, bitrate: 320000, sampleRate: 44100 },
      resolver: [{ extractor: 'bandcamp', id: '42', fulltitle: 'Full', duration: 301 }],
      timestamp: 5000
    })
    const labels = add_labels({ oplog, key_pair: writer, track_id: compute_track_id('AQAA-track'), set: ['night', 'deep'] })
    await projector.project_entries({ oplog, entries: [entry, labels] })
    const track = get_track({ db, track_id: compute_track_id('AQAA-track'), own_library_addresses: [oplog.chain.address] })
    expect(track).toMatchObject({
      library_address: oplog.chain.address,
      title: 'Title',
      artist: 'Artist',
      artists: ['Artist', 'Guest'],
      album: 'Album',
      album_artist: 'Album Artist',
      remixer: null,
      genre: ['house'],
      bpm: 124,
      duration_seconds: 301.5,
      bitrate: 320000,
      codec: 'MPEG 1 Layer 3',
      sample_rate: 44100,
      lossless: false,
      audio_size_bytes: 4096,
      resolvers: [{ extractor: 'bandcamp', id: '42', fulltitle: 'Full', duration_seconds: 301 }],
      tags: [{ library_address: oplog.chain.address, tag: 'deep' }, { library_address: oplog.chain.address, tag: 'night' }],
      listen_count: 0,
      listen_timestamps_ms: [],
      have_track: true,
      added_at_ms: 5000
    })
    expect(track?.content_cid).toBe((entry.operation as { value: { content: string } }).value.content)
    expect(track?.artwork).toHaveLength(1)
  })

  test('a label record sets and unsets pairs without touching the track row or reading its content', async () => {
    const writer = generate_key_pair()
    const { oplog, block_store } = await open_test_library({ writers: [writer] })
    const db = open_query_db()
    const reads: string[] = []
    const projector = create_projector({ db, read_content: async (cid) => { reads.push(cid); return await block_store.get(cid) } })
    const track_id = compute_track_id('AQAA-track')
    const put = await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-track', title: 'Title', timestamp: 10 })
    await projector.project_entries({ oplog, entries: [put, add_labels({ oplog, key_pair: writer, track_id, set: ['old', 'kept'], timestamp: 11 })] })
    reads.length = 0
    const relabel = add_labels({ oplog, key_pair: writer, track_id, set: ['new'], unset: ['old'], timestamp: 20 })
    await projector.project_entries({ oplog, entries: [relabel] })
    expect(reads).toEqual([])
    expect(get_track({ db, track_id })).toMatchObject({ title: 'Title', added_at_ms: 10, tags: [{ tag: 'kept' }, { tag: 'new' }] })
    expect(db.prepare('SELECT entry_hash FROM tracks WHERE track_id = ?').get(track_id)?.entry_hash).toBe(put.hash)
    expect(db.prepare("SELECT entry_hash FROM tags WHERE track_id = ? AND tag = 'new'").get(track_id)?.entry_hash).toBe(relabel.hash)
    expect(get_library_summary({ db, library_address: oplog.chain.address })).toEqual(scanned_summary(db, oplog.chain.address))
  })

  test('labels name any track id and outlive its DEL, applying again on re-adoption', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const track_id = compute_track_id('AQAA-track')
    // Labelled before any library holds it.
    await projector.project_entries({ oplog, entries: [add_labels({ oplog, key_pair: writer, track_id, set: ['early'] })] })
    expect(db.prepare('SELECT tag FROM tags WHERE track_id = ?').all(track_id)).toEqual([{ tag: 'early' }])
    expect(get_track({ db, track_id })).toBeUndefined()
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-track', timestamp: 10 })] })
    expect(get_track({ db, track_id })?.tags.map(({ tag }) => tag)).toEqual(['early'])
    await projector.project_entries({ oplog, entries: [delete_track({ oplog, key_pair: writer, key: track_id, timestamp: 20 })] })
    expect(db.prepare('SELECT tag FROM tags WHERE track_id = ?').all(track_id)).toEqual([{ tag: 'early' }])
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-track', title: 'Back', timestamp: 30 })] })
    expect(get_track({ db, track_id })).toMatchObject({ title: 'Back', tags: [{ tag: 'early' }] })
  })

  test('a labels library projects its label records and nothing else', async () => {
    const writer = generate_key_pair()
    const { oplog } = await open_test_library({ name: 'labels', type: 'labels', writers: [writer] })
    const db = open_query_db()
    const projector = create_projector({ db, read_content: async () => undefined })
    const track_id = compute_track_id('AQAA-track')
    await projector.project_entries({ oplog, entries: [add_labels({ oplog, key_pair: writer, track_id, set: ['mine'] })] })
    expect(db.prepare('SELECT library_address, tag FROM tags').all()).toEqual([{ library_address: oplog.chain.address, tag: 'mine' }])
    await projector.project_keys({ oplog, keys: oplog.key_entries.keys() })
    expect(db.prepare('SELECT count(*) AS count FROM tags').get()?.count).toBe(1)
    expect(await projector.projection_state({ library_address: oplog.chain.address })).toEqual({ heads: [...oplog.heads], pending: [] })
  })

  test('a current DEL tombstones the key and removes its rows', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const track_id = compute_track_id('AQAA-track')
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-track', resolver: [{ extractor: 'y', id: '1' }] })] })
    await projector.project_entries({ oplog, entries: [delete_track({ oplog, key_pair: writer, key: track_id })] })
    expect(get_track({ db, track_id })).toBeUndefined()
    expect(db.prepare('SELECT op FROM entries WHERE key = ?').get(track_id)?.op).toBe('DEL')
    for (const table of ['tracks', 'resolvers']) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count).toBe(0)
    }
    expect(get_library_summary({ db, library_address: oplog.chain.address })).toEqual({ track_count: 0, audio_size_bytes: 0, linked_library_count: 0, length: 0 })
  })

  test('the About record projects its name', async () => {
    const { oplog, writer, db, projector } = await setup()
    await projector.project_entries({ oplog, entries: [set_about({ oplog, key_pair: writer, name: 'Mine' })] })
    expect(get_about({ db, library_address: oplog.chain.address })).toEqual({
      library_address: oplog.chain.address,
      name: 'Mine',
      bio: null,
      location: null,
      avatar: null
    })
    expect(get_library_summary({ db, library_address: oplog.chain.address })).toEqual({ track_count: 0, audio_size_bytes: 0, linked_library_count: 0, length: 1 })
  })

  test('a track whose content is not stored yet fills in when re-projected', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const track_id = compute_track_id('AQAA-late')
    const entry = await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-late', title: 'Late', store: false })
    await projector.project_entries({ oplog, entries: [entry] })
    expect(get_track({ db, track_id })).toMatchObject({ title: null, audio_cid: null, artwork: [] })
    await store_content({ block_store, value: track_content({ fingerprint: 'AQAA-late', title: 'Late' }) })
    await projector.project_keys({ oplog, keys: [track_id] })
    expect(get_track({ db, track_id })?.title).toBe('Late')
  })

  test('listens append one row per entry and count across listens libraries', async () => {
    const { db, projector } = await setup()
    const writer = generate_key_pair()
    const listens = await open_test_library({ name: 'listens', type: 'listens', writers: [writer] })
    const track_id = 'b'.repeat(64)
    for (const timestamp of [300, 100, 200]) {
      const entry = append_listen({ oplog: listens.oplog, track_id, address: '/record/x/y', key_pair: writer, timestamp })
      await projector.project_entries({ oplog: listens.oplog, entries: [entry] })
      // Projection is idempotent per entry.
      await projector.project_entries({ oplog: listens.oplog, entries: [entry] })
    }
    expect(get_listen_count({ db, track_id })).toEqual({ track_id, count: 3, timestamps_ms: [300, 200, 100] })
  })

  test('remove_library drops every row of one library only', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const other = await open_test_library({ name: 'other', writers: [writer] })
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-1' })] })
    await projector.project_entries({ oplog, entries: [add_labels({ oplog, key_pair: writer, track_id: compute_track_id('AQAA-1'), set: ['t'] })] })
    await projector.project_entries({ oplog: other.oplog, entries: [await add_track({ oplog: other.oplog, key_pair: writer, block_store, fingerprint: 'AQAA-2' })] })
    await projector.remove_library({ library_address: oplog.chain.address })
    const libraries = db.prepare('SELECT DISTINCT library_address FROM entries UNION SELECT DISTINCT library_address FROM tags').all()
    expect(libraries.map(({ library_address }) => library_address)).toEqual([other.chain.address])
  })

  test('library totals follow adds, corrections, late content, deletes, and removal', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const address = oplog.chain.address
    const check = () => { expect(get_library_summary({ db, library_address: address })).toEqual(scanned_summary(db, address)) }
    for (const fingerprint of ['AQAA-1', 'AQAA-2', 'AQAA-3']) {
      await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint })] })
    }
    check()
    expect(get_library_summary({ db, library_address: address })).toMatchObject({ track_count: 3, audio_size_bytes: 3 * 4096, length: 3 })
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-1', title: 'retitled', timestamp: 99 })] })
    const late = await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-late', store: false })
    await projector.project_entries({ oplog, entries: [late] })
    check()
    await store_content({ block_store, value: track_content({ fingerprint: 'AQAA-late' }) })
    await projector.project_keys({ oplog, keys: [compute_track_id('AQAA-late')] })
    await projector.project_entries({ oplog, entries: [delete_track({ oplog, key_pair: writer, key: compute_track_id('AQAA-2') })] })
    check()
    expect(get_library_summary({ db, library_address: address })).toMatchObject({ track_count: 3, audio_size_bytes: 3 * 4096, linked_library_count: 0 })
    await projector.remove_library({ library_address: address })
    expect(get_library_summary({ db, library_address: address })).toEqual({ track_count: 0, audio_size_bytes: 0, linked_library_count: 0, length: 0 })
  })

  test('an index of an older schema version is dropped at open, so the next library open rebuilds it by replay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'record-schema-'))
    try {
      const path = join(dir, 'index.sqlite')
      const writer = generate_key_pair()
      const library = await open_test_library({ writers: [writer] })
      const address = library.oplog.chain.address
      const db = open_query_db({ path })
      const projector = create_projector({ db, read_content: library.block_store.get })
      await projector.project_entries({ oplog: library.oplog, entries: [await add_track({ oplog: library.oplog, key_pair: writer, block_store: library.block_store, fingerprint: 'AQAA-1' })] })
      expect(await projector.projection_state({ library_address: address })).toBeDefined()
      db.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'")
      db.close()
      const reopened = open_query_db({ path })
      expect(reopened.prepare('SELECT count(*) AS count FROM tracks').get()?.count).toBe(0)
      expect(await create_projector({ db: reopened, read_content: library.block_store.get }).projection_state({ library_address: address })).toBeUndefined()
      reopened.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an unfiltered list without shared track ids counts from the totals', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const other = await open_test_library({ name: 'other', writers: [writer] })
    for (const [library, fingerprint] of [[oplog, 'AQAA-1'], [oplog, 'AQAA-2'], [other.oplog, 'AQAA-3']] as const) {
      await projector.project_entries({ oplog: library, entries: [await add_track({ oplog: library, key_pair: writer, block_store, fingerprint })] })
    }
    const both = [oplog.chain.address, other.chain.address]
    expect(list_tracks({ db }).total).toBe(3)
    expect(list_tracks({ db, library_addresses: both }).total).toBe(3)
    expect(list_tracks({ db, library_addresses: [other.chain.address] }).total).toBe(1)
    expect(list_tracks({ db, library_addresses: [] }).total).toBe(0)
    await projector.project_entries({ oplog, entries: [delete_track({ oplog, key_pair: writer, key: compute_track_id('AQAA-1') })] })
    expect(list_tracks({ db, library_addresses: both }).total).toBe(2)
  })

  test('tracks.listen_count follows listens projected before and after the track', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'record-listen-count-'))
    try {
      const path = join(dir, 'index.sqlite')
      const writer = generate_key_pair()
      const library = await open_test_library({ writers: [writer] })
      const listens = await open_test_library({ name: 'listens', type: 'listens', writers: [writer] })
      const db = open_query_db({ path })
      const projector = create_projector({ db, read_content: library.block_store.get })
      const track_id = compute_track_id('AQAA-heard')
      const listen = async (timestamp: number) => {
        await projector.project_entries({ oplog: listens.oplog, entries: [append_listen({ oplog: listens.oplog, track_id, address: library.chain.address, key_pair: writer, timestamp })] })
      }
      const stored = (target: DatabaseSync) => Number(target.prepare('SELECT listen_count FROM tracks WHERE track_id = ?').get(track_id)?.listen_count)
      await listen(1)
      await projector.project_entries({ oplog: library.oplog, entries: [await add_track({ oplog: library.oplog, key_pair: writer, block_store: library.block_store, fingerprint: 'AQAA-heard' })] })
      await projector.project_entries({ oplog: library.oplog, entries: [await add_track({ oplog: library.oplog, key_pair: writer, block_store: library.block_store, fingerprint: 'AQAA-quiet' })] })
      await listen(2)
      expect(stored(db)).toBe(2)
      expect(list_tracks({ db, sort: 'listen_count', order: 'desc' }).items[0]).toMatchObject({ id: track_id, listen_count: 2 })
      const plan = db.prepare('EXPLAIN QUERY PLAN SELECT t.track_id FROM tracks AS t ORDER BY t.listen_count DESC, t.track_id DESC LIMIT 10').all()
      expect(JSON.stringify(plan)).toContain('tracks_by_listen_count')
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
