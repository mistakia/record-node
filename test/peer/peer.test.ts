// Peer assembly over the Helia store on disk: restart, links, profiles,
// removal, and identity import.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { download_to_file } from '#ingest/download.ts'
import { data_paths } from '#peer/config.ts'
import { create_peer, start_peer, stop_peer, type Peer } from '#peer/peer.ts'
import { audio_pipeline_vector as f7 } from '#test/conformance/vectors.ts'
import { preflight_bypassed } from '#test/helpers/ingest.ts'
import type { PeerEvent, TrackQuery } from '#types/peer.ts'

const QUERY: TrackQuery = { offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' }
const running: Peer[] = []

const start = async (data_dir?: string): Promise<Peer> => {
  const peer = await create_peer({ config: { allow_toolchain_mismatch: preflight_bypassed, ...(data_dir === undefined ? {} : { data_dir }) } })
  await start_peer(peer)
  running.push(peer)
  return peer
}

const stop = async (peer: Peer) => {
  running.splice(running.indexOf(peer), 1)
  await stop_peer(peer)
}

afterEach(async () => {
  for (const peer of running.splice(0)) await stop_peer(peer)
})

describe('peer', () => {
  test('a restart reopens the same libraries with their tracks, labels, and listens', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-peer-test-'))
    const first = await start(data_dir)
    await first.ingest_file(f7.fixture_path)
    await first.add_tag({ track_id: f7.track_id, tag: 'kept' })
    await first.record_listen({ track_id: f7.track_id, library_address: first.identity().own_address })
    const { own_address, listens_address } = first.identity()
    await stop(first)
    expect(statSync(data_paths(data_dir).identity).mode & 0o777).toBe(0o600)

    const second = await start(data_dir)
    expect(second.identity()).toMatchObject({ own_address, listens_address })
    const { items } = await second.list_tracks(QUERY)
    expect(items).toEqual([expect.objectContaining({ id: f7.track_id, tags: [{ library_address: own_address, tag: 'kept' }], listen_count: 1 })])
    expect((await second.get_audio(f7.audio_cid))?.length).toBe(items[0]?.audio_size_bytes)
    expect(await second.content_store.is_pinned(f7.audio_cid)).toBe(true)
  })

  test('removing a track tombstones it and emits track:removed', async () => {
    const peer = await start()
    const events: PeerEvent[] = []
    peer.subscribe((event) => { events.push(event) })
    await peer.ingest_file(f7.fixture_path)
    await peer.remove_track(f7.track_id)
    expect((await peer.list_tracks(QUERY)).total).toBe(0)
    expect(events.map(({ type }) => type)).toContain('track:removed')
    await expect(peer.remove_track(f7.track_id)).rejects.toMatchObject({ code: 'not_found' })
  })

  test('the About entry is stamped with the own address and merges updates', async () => {
    const peer = await start()
    const address = peer.identity().own_address
    await peer.set_about({ address, fields: { name: 'mine', bio: 'first' } })
    expect(await peer.set_about({ address, fields: { bio: null, location: 'here' } }))
      .toEqual({ library_address: address, name: 'mine', bio: null, location: 'here', avatar: null })
    expect(await peer.set_about({ address, fields: {} })).toMatchObject({ name: 'mine', location: 'here' })
    expect((await peer.get_library(address))?.name).toBe('mine')
  })

  test('linking an unknown library records it as loading; unlinking ends the link', async () => {
    const peer = await start()
    const other = await start()
    const address = other.identity().own_address
    const library = await peer.link_library({ address, alias: 'friend' })
    expect(library).toMatchObject({ address, alias: 'friend', is_linked: true, is_loading_index: true })
    expect((await peer.list_libraries()).map(({ address }) => address)).toEqual([peer.identity().own_address, address])
    await peer.unlink_library(address)
    expect(await peer.get_library(address)).toBeUndefined()
    await expect(peer.unlink_library(peer.identity().own_address)).rejects.toMatchObject({ code: 'forbidden' })
  })

  test('importing a new identity opens its own library, and the old key reopens the old one', async () => {
    const peer = await start()
    await peer.ingest_file(f7.fixture_path)
    const { private_key } = await peer.export_identity()
    const old_address = peer.identity().own_address
    const fresh = await peer.import_identity({})
    expect(fresh.own_library_address).not.toBe(old_address)
    expect((await peer.list_tracks(QUERY)).total).toBe(0)
    expect(await peer.import_identity({ private_key })).toMatchObject({ own_library_address: old_address })
    expect((await peer.list_tracks(QUERY)).total).toBe(1)
    await expect(peer.import_identity({ private_key: 'zz' })).rejects.toMatchObject({ code: 'invalid_private_key' })
  })

  test("a listen count covers the current identity's listens only", async () => {
    const peer = await start()
    await peer.record_listen({ track_id: f7.track_id, library_address: peer.identity().own_address })
    await peer.import_identity({})
    expect(await peer.record_listen({ track_id: f7.track_id, library_address: peer.identity().own_address }))
      .toMatchObject({ track_id: f7.track_id, count: 1 })
  })

  test('only a complete local UnixFS file is audio; other blocks are absent, not errors', async () => {
    const peer = await start()
    const track = await peer.ingest_file(f7.fixture_path)
    for (const cid of [track.content_cid, track.entry_hash]) {
      expect(await peer.has_audio(cid)).toBe(false)
      expect(await peer.get_audio(cid)).toBeUndefined()
    }
    expect(await peer.has_audio(f7.audio_cid)).toBe(true)
  })

  test('stop drains queued ingests and refuses a restart', async () => {
    const peer = await start()
    const ingest = peer.ingest_file(f7.fixture_path)
    await stop(peer)
    expect(await ingest).toMatchObject({ track_id: f7.track_id })
    await expect(peer.ingest_file(f7.fixture_path)).rejects.toThrow('stopping')
    await expect(start_peer(peer)).rejects.toThrow('does not start again')
  })
})

describe('download', () => {
  test('a refused or broken download is download_failed', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('gone', { status: 410 }) })
    try {
      const output_path = join(mkdtempSync(join(tmpdir(), 'record-download-test-')), 'a.m4a')
      await expect(download_to_file({ url: `http://127.0.0.1:${server.port}/a.m4a`, output_path })).rejects.toMatchObject({ code: 'download_failed' })
      await expect(download_to_file({ url: 'http://127.0.0.1:1/a.m4a', output_path })).rejects.toMatchObject({ code: 'download_failed' })
    } finally {
      await server.stop(true)
    }
  })
})
