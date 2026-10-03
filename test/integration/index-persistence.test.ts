// §4.7 index persistence: a restart with a data dir opens the persisted query
// index instead of re-projecting every library from blocks, re-projects only
// keys whose content was missing at the last write, and rebuilds the whole
// index when its file is missing, corrupt, or written by an older schema.
//
// A track whose content block has been deleted separates a reopen from a
// replay: a reopen keeps the persisted populated row, while a replay reads the
// missing payload and writes the row back with null content columns. The tests
// assert on that row to prove which happened.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { build_track_envelope } from '#entry/envelope.ts'
import { compute_track_id } from '#entry/id.ts'
import { build_put_operation } from '#entry/operations.ts'
import { parse_content_cid } from '#fabric/block.ts'
import { data_paths } from '#peer/config.ts'
import { create_peer, start_peer, stop_peer, type Peer } from '#peer/peer.ts'
import { open_query_db } from '#query-db/schema.ts'
import { preflight_bypassed } from '#test/helpers/ingest.ts'
import { dump_query_db, store_content, track_content } from '#test/query-db/fixtures.ts'

const running: Peer[] = []

afterEach(async () => {
  for (const peer of running.splice(0)) await stop_peer(peer)
})

const reopen = async (data_dir: string): Promise<Peer> => {
  const peer = await create_peer({ config: { allow_toolchain_mismatch: preflight_bypassed, network: false, data_dir } })
  await start_peer(peer)
  running.push(peer)
  return peer
}

// Stores a rich content payload (title, artist, audio, resolver) and appends
// its track, so the projected row is visibly populated while the payload is
// stored and visibly null when a replay cannot read it.
const append_track = async (peer: Peer, fingerprint: string) => {
  const value = track_content({
    fingerprint,
    title: `Title ${fingerprint}`,
    artist: 'Artist',
    audio: { duration: 123, bitrate: 320000, sampleRate: 44100 },
    resolver: [{ extractor: 'bandcamp', id: fingerprint, fulltitle: 'Full' }]
  })
  const content_cid = await store_content({ block_store: peer.content_store, value })
  const { key_pair, own_address } = peer.identity()
  const payload = build_put_operation({ envelope: build_track_envelope({ id: compute_track_id(fingerprint), content_cid }) })
  await peer.context.libraries.append({ library_address: own_address, payload, key_pair })
  return { content_cid, track_id: compute_track_id(fingerprint) }
}

// Removes a track's content payload from the store without disturbing the
// index, so a later replay — but not a reopen — writes the row back null.
const drop_content = async (peer: Peer, content_cid: string) => {
  await peer.content_store.unpin(content_cid)
  await peer.context.store.helia.blockstore.delete(parse_content_cid(content_cid) as never)
}

const title_of = (peer: Peer, track_id: string) =>
  (peer.db.prepare('SELECT title FROM tracks WHERE track_id = ?').get(track_id) as { title: string | null } | undefined)?.title

const index_snapshot = (data_dir: string) => {
  const db = open_query_db({ path: data_paths(data_dir).index })
  const snapshot = dump_query_db(db)
  db.close()
  return snapshot
}

describe('query index persistence', () => {
  test('a restart reopens the persisted index without replaying the library', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-index-restart-'))
    const first = await reopen(data_dir)
    const track = await append_track(first, 'AQAA-restart')
    const own_address = first.identity().own_address
    const snapshot = index_snapshot(data_dir)
    await drop_content(first, track.content_cid)
    await stop_peer(first)
    running.splice(0)

    const second = await reopen(data_dir)
    // The revoked content would degrade the row to nulls on any replay; it is
    // still populated, so the start reopened the persisted index instead.
    expect(title_of(second, track.track_id)).toBe('Title AQAA-restart')
    expect(dump_query_db(second.db)).toEqual(snapshot)
    // The marker names the same heads as the oplog that grew out of them.
    const marker = second.db.prepare('SELECT heads FROM library_heads WHERE library_address = ?').get(own_address) as { heads: string }
    const actual_heads = [...second.context.libraries.get(own_address)?.oplog.heads ?? []].sort()
    expect(JSON.parse(marker.heads)).toEqual(actual_heads)
  })

  test('an append after a restart is the only replay, and the next restart skips it too', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-index-delta-'))
    const first = await reopen(data_dir)
    const a = await append_track(first, 'AQAA-delta-a')
    await drop_content(first, a.content_cid)
    await stop_peer(first)
    running.splice(0)

    const second = await reopen(data_dir)
    expect(title_of(second, a.track_id)).toBe('Title AQAA-delta-a')
    const b = await append_track(second, 'AQAA-delta-b')
    const snapshot = index_snapshot(data_dir)
    await stop_peer(second)
    running.splice(0)

    const third = await reopen(data_dir)
    expect(dump_query_db(third.db)).toEqual(snapshot)
    expect(title_of(third, a.track_id)).toBe('Title AQAA-delta-a')
    expect(title_of(third, b.track_id)).toBe('Title AQAA-delta-b')
  })

  test('a corrupt index file is rebuilt by replay, and the rest of the index reproduces', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-index-corrupt-'))
    const first = await reopen(data_dir)
    const revoked = await append_track(first, 'AQAA-corrupt-revoked')
    const kept = await append_track(first, 'AQAA-corrupt-kept')
    await drop_content(first, revoked.content_cid)
    await stop_peer(first)
    running.splice(0)
    const snapshot = index_snapshot(data_dir)

    const index_path = data_paths(data_dir).index
    rmSync(`${index_path}-wal`, { force: true })
    rmSync(`${index_path}-shm`, { force: true })
    writeFileSync(index_path, 'this is not a sqlite database')

    const second = await reopen(data_dir)
    // The index was rebuilt, so the revoked content is re-projected as missing,
    // and the kept track reprojects to the row the first run wrote.
    expect(title_of(second, revoked.track_id)).toBeNull()
    expect(title_of(second, kept.track_id)).toBe('Title AQAA-corrupt-kept')
    expect(dump_query_db(second.db)).not.toEqual(snapshot)
  })

  test('an index written before the marker tables is rebuilt by replay', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-index-schema-'))
    const first = await reopen(data_dir)
    const track = await append_track(first, 'AQAA-schema')
    await drop_content(first, track.content_cid)
    await stop_peer(first)
    running.splice(0)
    const snapshot = index_snapshot(data_dir)

    // Strip the marker and version tables, as a pre-persistence index would be.
    const index_path = data_paths(data_dir).index
    const db = open_query_db({ path: index_path })
    db.exec('DROP TABLE library_heads')
    db.exec('DROP TABLE meta')
    db.close()

    const second = await reopen(data_dir)
    expect(title_of(second, track.track_id)).toBeNull()
    expect(dump_query_db(second.db)).not.toEqual(snapshot)
  })
})

describe('entry block cache', () => {
  const cached_hashes = (peer: Peer, library_address: string) =>
    (peer.db.prepare('SELECT entry_hash FROM entry_blocks WHERE library_address = ? ORDER BY entry_hash').all(library_address) as Array<{ entry_hash: string }>)
      .map(({ entry_hash }) => entry_hash)
  const oplog_of = (peer: Peer, library_address: string) => peer.context.libraries.get(library_address)?.oplog

  test('a restart reads the oplog from the cache, without the entry blocks in the store', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-entry-cache-'))
    const first = await reopen(data_dir)
    const own_address = first.identity().own_address
    for (const fingerprint of ['AQAA-cache-a', 'AQAA-cache-b', 'AQAA-cache-c']) await append_track(first, fingerprint)
    const hashes = [...oplog_of(first, own_address)?.entries.keys() ?? []].sort()
    expect(cached_hashes(first, own_address)).toEqual(hashes)
    // A walk from the heads would stop at the first missing block.
    for (const hash of hashes) await drop_content(first, hash)
    await stop_peer(first)
    running.splice(0)

    const second = await reopen(data_dir)
    expect([...oplog_of(second, own_address)?.entries.keys() ?? []].sort()).toEqual(hashes)
  })

  test('a cache behind the persisted heads is replaced by a walk of the blockstore', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-entry-cache-behind-'))
    const first = await reopen(data_dir)
    const own_address = first.identity().own_address
    for (const fingerprint of ['AQAA-behind-a', 'AQAA-behind-b']) await append_track(first, fingerprint)
    const hashes = [...oplog_of(first, own_address)?.entries.keys() ?? []].sort()
    await stop_peer(first)
    running.splice(0)
    // As after a crash between the heads and the cache write, or an index
    // written before the cache existed.
    const db = open_query_db({ path: data_paths(data_dir).index })
    db.prepare('DELETE FROM entry_blocks WHERE library_address = ? AND entry_hash = ?').run(own_address, hashes[0] as string)
    db.close()

    const second = await reopen(data_dir)
    expect([...oplog_of(second, own_address)?.entries.keys() ?? []].sort()).toEqual(hashes)
    expect(cached_hashes(second, own_address)).toEqual(hashes)
  })
})
