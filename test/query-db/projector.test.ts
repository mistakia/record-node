// Incremental projection of appends, relabels, DELs, links, profiles, and
// listens, and late-arriving content.

import { describe, expect, test } from 'bun:test'

import { compute_track_id } from '#entry/id.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { append_listen } from '#oplog/listens.ts'
import { create_projector } from '#query-db/projector.ts'
import { get_about, get_library_summary, get_listen_count, get_track, list_linked_libraries } from '#query-db/queries.ts'
import { open_query_db } from '#query-db/schema.ts'
import { open_test_library } from '#test/helpers/library.ts'
import { add_link, add_track, delete_track, set_about, store_content, track_content } from './fixtures.ts'

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
      tags: ['deep', 'night'],
      timestamp: 5000
    })
    await projector.project_entries({ oplog, entries: [entry] })
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

  test('a relabel replaces tags and keeps the first-seen time', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const track_id = compute_track_id('AQAA-track')
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-track', tags: ['old'], timestamp: 10 })] })
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-track', tags: ['new'], timestamp: 20 })] })
    const track = get_track({ db, track_id })
    expect(track?.tags.map(({ tag }) => tag)).toEqual(['new'])
    expect(track?.added_at_ms).toBe(10)
  })

  test('a current DEL tombstones the key and removes its rows', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const track_id = compute_track_id('AQAA-track')
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-track', tags: ['x'], resolver: [{ extractor: 'y', id: '1' }] })] })
    await projector.project_entries({ oplog, entries: [delete_track({ oplog, key_pair: writer, key: track_id })] })
    expect(get_track({ db, track_id })).toBeUndefined()
    expect(db.prepare('SELECT op FROM entries WHERE key = ?').get(track_id)?.op).toBe('DEL')
    for (const table of ['tracks', 'tags', 'resolvers']) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count).toBe(0)
    }
    expect(get_library_summary({ db, library_address: oplog.chain.address })).toEqual({ track_count: 0, audio_size_bytes: 0, linked_library_count: 0, length: 0 })
  })

  test('links and the profile project from log and about payloads', async () => {
    const { oplog, writer, block_store, db, projector } = await setup()
    const other = await open_test_library({ name: 'other' })
    await projector.project_entries({ oplog, entries: [await add_link({ oplog, key_pair: writer, block_store, address: other.chain.address, alias: 'friend' })] })
    await projector.project_entries({ oplog, entries: [await set_about({ oplog, key_pair: writer, block_store, profile: { name: 'Mine', bio: 'Bio' } })] })
    expect(list_linked_libraries({ db, library_address: oplog.chain.address })).toEqual([{ address: other.chain.address, alias: 'friend' }])
    expect(get_about({ db, library_address: oplog.chain.address })).toEqual({
      library_address: oplog.chain.address,
      name: 'Mine',
      bio: 'Bio',
      location: null,
      avatar: null
    })
    expect(get_library_summary({ db, library_address: oplog.chain.address })).toEqual({ track_count: 0, audio_size_bytes: 0, linked_library_count: 1, length: 2 })
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
    await projector.project_entries({ oplog, entries: [await add_track({ oplog, key_pair: writer, block_store, fingerprint: 'AQAA-1', tags: ['t'] })] })
    await projector.project_entries({ oplog: other.oplog, entries: [await add_track({ oplog: other.oplog, key_pair: writer, block_store, fingerprint: 'AQAA-2' })] })
    await projector.remove_library({ library_address: oplog.chain.address })
    const libraries = db.prepare('SELECT DISTINCT library_address FROM entries UNION SELECT DISTINCT library_address FROM tags').all()
    expect(libraries.map(({ library_address }) => library_address)).toEqual([other.chain.address])
  })
})
