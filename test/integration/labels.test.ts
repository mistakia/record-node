// Envelope label writes and filters (§2.4.3, chapter 7): a label change that
// appends nothing when the set is equal, a batch appended and reported as one
// change, labels on adoption, any-of label groups, and label prefixes.

import { afterEach, describe, expect, test } from 'bun:test'

import type { Peer } from '#peer/peer.ts'
import { stored_track } from '#test/helpers/library-manager.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'
import type { PeerEvent, TrackQuery } from '#types/peer.ts'

const QUERY: TrackQuery = { offset: 0, limit: 50, shuffle: false, sort: 'added_at', order: 'desc' }

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const entry_count = (peer: Peer): number =>
  peer.context.libraries.get(peer.identity().own_address)?.oplog.entries.size ?? 0

const labels_of = async (peer: Peer, track_id: string): Promise<string[]> =>
  (await peer.list_tracks(QUERY)).items.find(({ id }) => id === track_id)?.tags.map(({ tag }) => tag) ?? []

// Tracks in the peer's own library, by fingerprint.
const own_tracks = async (peer: Peer, fingerprints: readonly string[]): Promise<string[]> => {
  const ids: string[] = []
  for (const fingerprint of fingerprints) {
    const { entry } = await append_track({ peer, fingerprint })
    ids.push((entry.operation as { key: string }).key)
  }
  return ids
}

const recording = (peer: Peer): PeerEvent[] => {
  const events: PeerEvent[] = []
  peer.subscribe((event) => { events.push(event) })
  return events
}

describe('labels', () => {
  test('a label change adds, removes, or sets, and an equal set appends nothing', async () => {
    const peer = await peers.start()
    const [track_id] = await own_tracks(peer, ['AQADlabel']) as [string]

    // A track lists its labels sorted.
    expect((await peer.change_labels({ track_id, add: ['genre/house', 'era/2010s'] })).tags.map(({ tag }) => tag)).toEqual(['era/2010s', 'genre/house'])
    expect((await peer.change_labels({ track_id, remove: ['era/2010s'], add: ['era/2020s'] })).tags.map(({ tag }) => tag)).toEqual(['era/2020s', 'genre/house'])
    const before = entry_count(peer)
    await peer.change_labels({ track_id, set: ['era/2020s', 'genre/house'] })
    await peer.change_labels({ track_id, add: ['genre/house'], remove: ['absent'] })
    expect(entry_count(peer)).toBe(before)
    expect((await peer.change_labels({ track_id, set: [] })).tags).toEqual([])
    expect(entry_count(peer)).toBe(before + 1)

    for (const change of [{}, { set: ['a'], add: ['b'] }, { add: ['a'], remove: ['a'] }]) {
      await expect(peer.change_labels({ track_id, ...change })).rejects.toMatchObject({ code: 'invalid' })
    }
    await expect(peer.change_labels({ track_id: '0'.repeat(64), add: ['a'] })).rejects.toMatchObject({ code: 'not_found' })
  })

  test('a batch applies items in order, fails items alone, and reports as one index update', async () => {
    const peer = await peers.start()
    const address = peer.identity().own_address
    const [first, second, third] = await own_tracks(peer, ['AQADbatch1', 'AQADbatch2', 'AQADbatch3']) as [string, string, string]
    await peer.change_labels({ track_id: third, add: ['kept'] })
    await peer.context.libraries.settled()
    const events = recording(peer)
    const before = entry_count(peer)

    const results = await peer.change_labels_batch({
      items: [
        { track_id: first, add: ['view/a'] },
        { track_id: second, set: ['view/a', 'view/b'] },
        { track_id: '0'.repeat(64), add: ['view/a'] },
        { track_id: third, add: ['kept'] },
        { track_id: first, add: ['view/c'] }
      ]
    })
    expect(results).toEqual([
      { track_id: first, status: 'updated', tags: ['view/a'] },
      { track_id: second, status: 'updated', tags: ['view/a', 'view/b'] },
      { track_id: '0'.repeat(64), status: 'failed', error: { code: 'NOT_FOUND', message: expect.any(String) } },
      { track_id: third, status: 'unchanged', tags: ['kept'] },
      { track_id: first, status: 'updated', tags: ['view/a', 'view/c'] }
    ])
    expect(entry_count(peer)).toBe(before + 3)
    expect(await labels_of(peer, first)).toEqual(['view/a', 'view/c'])
    expect(events.filter(({ type }) => type === 'track:added')).toEqual([])
    expect(events.filter(({ type }) => type === 'library:index-updated')).toEqual([{
      type: 'library:index-updated',
      payload: { library_address: address, track_count: 3, linked_library_count: 0, is_processing_index: false, processing_count: 0 }
    }])

    // A malformed item fails the batch before any item applies.
    await expect(peer.change_labels_batch({ items: [{ track_id: first, add: ['x'] }, { track_id: second }] })).rejects.toMatchObject({ code: 'invalid' })
    expect(await labels_of(peer, first)).toEqual(['view/a', 'view/c'])
  })

  test('a batch item its capability does not authorise fails alone', async () => {
    const owner = await peers.start()
    const grantee = await peers.start()
    const address = owner.identity().own_address
    await grantee.link_library({ address, alias: 'shared' })
    const [track_id] = await own_tracks(owner, ['AQADgranted']) as [string]
    await owner.change_labels({ track_id, add: ['owner-label'] })
    const capability = await owner.issue_capability({
      library_address: address,
      grantee: { type: 'key', key: grantee.identity().key_pair.public_key },
      actions: ['library.append_tag']
    })
    await wait_until(async () => (await grantee.list_held_capabilities()).some(({ capability_id, status }) => capability_id === capability.capability_id && status === 'active'))
    await wait_until(async () => (await grantee.list_tracks({ ...QUERY, library_addresses: [address] })).items.some(({ id, tags }) => id === track_id && tags.length === 1))

    const results = await grantee.change_labels_batch({
      items: [{ track_id, add: ['friend-label'] }, { track_id, remove: ['owner-label'] }],
      library_address: address,
      capability_id: capability.capability_id
    })
    expect(results).toEqual([
      { track_id, status: 'updated', tags: ['owner-label', 'friend-label'] },
      { track_id, status: 'failed', error: { code: 'FORBIDDEN', message: expect.any(String) } }
    ])
  })

  test('adoption carries labels in its PUT, and relabels a held track to them', async () => {
    const peer = await peers.start()
    const { content_cid } = await stored_track({ content_store: peer.content_store, fingerprint: 'AQADadopted', audio: 'adopted' })

    const adopted = await peer.add_track({ content_cid, tags: ['tier/personal', 'view/a'] })
    expect(adopted.tags.map(({ tag }) => tag)).toEqual(['tier/personal', 'view/a'])
    const after_adopt = entry_count(peer)
    await peer.add_track({ content_cid, tags: ['view/a', 'tier/personal'] })
    await peer.add_track({ content_cid })
    expect(entry_count(peer)).toBe(after_adopt)
    expect((await peer.add_track({ content_cid, tags: ['view/b'] })).tags.map(({ tag }) => tag)).toEqual(['view/b'])
    expect(entry_count(peer)).toBe(after_adopt + 1)
  })

  test('label groups match any label within a group and every group across them', async () => {
    const peer = await peers.start()
    const [house, techno, ambient] = await own_tracks(peer, ['AQADhouse', 'AQADtechno', 'AQADambient']) as [string, string, string]
    await peer.change_labels_batch({
      items: [
        { track_id: house, add: ['genre/house', 'era/2010s'] },
        { track_id: techno, add: ['genre/techno', 'era/2020s'] },
        { track_id: ambient, add: ['genre/ambient', 'era/2010s'] }
      ]
    })
    await peer.context.libraries.settled()

    const ids = async (query: Partial<TrackQuery>) => {
      const { items, total } = await peer.list_tracks({ ...QUERY, ...query })
      expect(total).toBe(items.length)
      return items.map(({ id }) => id).sort()
    }
    expect(await ids({ tag_groups: [['genre/house', 'genre/techno']] })).toEqual([house, techno].sort())
    expect(await ids({ tag_groups: [['genre/house', 'genre/techno'], ['era/2010s']] })).toEqual([house])
    expect(await ids({ tags: ['era/2010s'], tag_groups: [['genre/ambient', 'genre/techno']] })).toEqual([ambient])
    expect(await ids({ tag_groups: [['genre/none']] })).toEqual([])

    expect(await peer.list_tags({ prefix: 'era/' })).toEqual([{ tag: 'era/2010s', count: 2 }, { tag: 'era/2020s', count: 1 }])
    expect(await peer.list_tags({ prefix: 'genre/t' })).toEqual([{ tag: 'genre/techno', count: 1 }])
    expect(await peer.list_tags({ prefix: 'nothing' })).toEqual([])
    expect((await peer.list_tags({})).length).toBe(5)

    // Counts follow the index, not a cache that outlived it.
    await peer.change_labels({ track_id: techno, set: ['era/2010s'] })
    await peer.context.libraries.settled()
    expect(await peer.list_tags({ prefix: 'era/' })).toEqual([{ tag: 'era/2010s', count: 3 }])
  })
})
