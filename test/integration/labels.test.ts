// Label writes and reads (§2.5, chapter 7): one label record per write, the
// labels library as the default target, any track id held or not, per-pair
// state so concurrent writers' labels all survive, labels outliving a track
// DEL, capability-scoped sets and unsets, and label_libraries reads.

import { afterEach, describe, expect, test } from 'bun:test'

import { compute_track_id } from '#entry/id.ts'
import { is_labels_put } from '#entry/operations.ts'
import type { Peer } from '#peer/peer.ts'
import { stored_track } from '#test/helpers/library-manager.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'
import type { PeerEvent, Track, TrackLabels, TrackQuery } from '#types/peer.ts'

const QUERY: TrackQuery = { offset: 0, limit: 50, shuffle: false, sort: 'added_at', order: 'desc' }
const UNHELD = compute_track_id('AQADnobody-holds-this')

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const entry_count = (peer: Peer, address: string): number => peer.context.libraries.get(address)?.oplog.entries.size ?? 0

const label_records = (peer: Peer, address: string) =>
  [...peer.context.libraries.get(address)?.oplog.entries.values() ?? []].flatMap(({ operation }) => is_labels_put(operation) ? [operation.value] : [])

const tags_of = (result: Track | TrackLabels): string[] =>
  'id' in result ? result.tags.map(({ tag }) => tag) : result.tags

const labels_of = async (peer: Peer, track_id: string, query: Partial<TrackQuery> = {}): Promise<string[]> =>
  (await peer.list_tracks({ ...QUERY, ...query })).items.find(({ id }) => id === track_id)?.tags.map(({ tag }) => tag) ?? []

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
  test('a label change goes to the labels library, appends one record, and appends nothing when nothing changes', async () => {
    const peer = await peers.start()
    const { labels_address } = peer.identity()
    const [track_id] = await own_tracks(peer, ['AQADlabel']) as [string]
    const before = entry_count(peer, labels_address)

    expect(tags_of(await peer.change_labels({ track_id, add: ['genre/house', 'era/2010s'] }))).toEqual(['era/2010s', 'genre/house'])
    expect(tags_of(await peer.change_labels({ track_id, remove: ['era/2010s'], add: ['era/2020s'] }))).toEqual(['era/2020s', 'genre/house'])
    expect(entry_count(peer, labels_address)).toBe(before + 2)
    expect(label_records(peer, labels_address).at(-1)).toMatchObject({ set: [[track_id, 'era/2020s']], unset: [[track_id, 'era/2010s']] })
    // Pairs already in their requested state are omitted, so these append nothing.
    await peer.change_labels({ track_id, set: ['era/2020s', 'genre/house'] })
    await peer.change_labels({ track_id, add: ['genre/house'], remove: ['absent'] })
    await peer.add_tag({ track_id, tag: 'genre/house' })
    await peer.remove_tag({ track_id, tag: 'absent' })
    expect(entry_count(peer, labels_address)).toBe(before + 2)
    expect(tags_of(await peer.change_labels({ track_id, set: [] }))).toEqual([])
    expect(entry_count(peer, labels_address)).toBe(before + 3)

    // The node normalises to NFC before writing.
    expect(tags_of(await peer.add_tag({ track_id, tag: 'café' }))).toEqual(['café'])
    for (const change of [{}, { set: ['a'], add: ['b'] }, { add: ['a'], remove: ['a'] }, { add: ['x'.repeat(129)] }, { add: ['a\u0000b'] }]) {
      await expect(peer.change_labels({ track_id, ...change })).rejects.toMatchObject({ code: 'invalid' })
    }
    await expect(peer.change_labels({ track_id: 'not-a-track-id', add: ['a'] })).rejects.toMatchObject({ code: 'invalid' })
  })

  test('a label write takes a track id no library holds, and answers its labels', async () => {
    const peer = await peers.start()
    const { labels_address } = peer.identity()
    expect(await peer.add_tag({ track_id: UNHELD, tag: 'wishlist' })).toEqual({ track_id: UNHELD, tags: ['wishlist'] })
    expect(await peer.change_labels({ track_id: UNHELD, add: ['later'] })).toEqual({ track_id: UNHELD, tags: ['later', 'wishlist'] })
    expect(await peer.list_library_labels({ address: labels_address })).toEqual({
      library_address: labels_address,
      items: [{ track_id: UNHELD, tags: ['later', 'wishlist'] }],
      total: 1
    })
    // Held by nothing in scope, so it counts nowhere.
    expect(await peer.list_tags({})).toEqual([])
  })

  test('the default label_libraries count a labels-library label in an own recordstore\'s view', async () => {
    const peer = await peers.start()
    const { own_address, labels_address } = peer.identity()
    const [track_id, other] = await own_tracks(peer, ['AQADviewed', 'AQADother']) as [string, string]
    await peer.add_tag({ track_id, tag: 'mine' })
    await peer.add_tag({ track_id: other, tag: 'shared', library_address: own_address })

    expect(await peer.list_tags({ library_addresses: [own_address] })).toEqual([{ tag: 'mine', count: 1 }, { tag: 'shared', count: 1 }])
    const filtered = await peer.list_tracks({ ...QUERY, library_addresses: [own_address], tags: ['mine'] })
    expect(filtered.total).toBe(1)
    expect(filtered.items[0]?.tags).toEqual([{ library_address: labels_address, tag: 'mine' }])
    // An explicit label_libraries narrows whose labels count.
    expect(await peer.list_tags({ library_addresses: [own_address], label_libraries: [own_address] })).toEqual([{ tag: 'shared', count: 1 }])
    expect((await peer.list_tracks({ ...QUERY, library_addresses: [own_address], label_libraries: [own_address], tags: ['mine'] })).total).toBe(0)
  })

  test('labels outlive a track DEL and apply again when the track returns', async () => {
    const peer = await peers.start()
    const { own_address, labels_address } = peer.identity()
    const { content_cid } = await stored_track({ content_store: peer.content_store, fingerprint: 'AQADreturns', audio: 'returns' })
    const { id: track_id } = await peer.add_track({ content_cid })
    await peer.add_tag({ track_id, tag: 'keeper' })
    await peer.remove_track({ track_id, library_address: own_address })
    expect((await peer.list_tracks(QUERY)).total).toBe(0)
    expect((await peer.list_library_labels({ address: labels_address })).items).toEqual([{ track_id, tags: ['keeper'] }])
    expect(await peer.add_tag({ track_id, tag: 'keeper' })).toEqual({ track_id, tags: ['keeper'] })
    expect(tags_of(await peer.add_track({ content_cid }))).toEqual(['keeper'])
  })

  test('a batch applies items in order as one label record, takes unheld ids, and fails a malformed batch whole', async () => {
    const peer = await peers.start()
    const { labels_address } = peer.identity()
    const [first, second, third] = await own_tracks(peer, ['AQADbatch1', 'AQADbatch2', 'AQADbatch3']) as [string, string, string]
    await peer.change_labels({ track_id: third, add: ['kept'] })
    await peer.context.libraries.settled()
    const events = recording(peer)
    const before = entry_count(peer, labels_address)

    const results = await peer.change_labels_batch({
      items: [
        { track_id: first, add: ['view/a'] },
        { track_id: second, set: ['view/a', 'view/b'] },
        { track_id: UNHELD, add: ['view/a'] },
        { track_id: third, add: ['kept'] },
        { track_id: first, add: ['view/c'] },
        { track_id: second, remove: ['view/b'] }
      ]
    })
    expect(results).toEqual([
      { track_id: first, status: 'updated', tags: ['view/a'] },
      { track_id: second, status: 'updated', tags: ['view/a', 'view/b'] },
      { track_id: UNHELD, status: 'updated', tags: ['view/a'] },
      { track_id: third, status: 'unchanged', tags: ['kept'] },
      { track_id: first, status: 'updated', tags: ['view/a', 'view/c'] },
      { track_id: second, status: 'updated', tags: ['view/a'] }
    ])
    expect(entry_count(peer, labels_address)).toBe(before + 1)
    // view/b on second was set and unset within the batch, so the record omits it.
    const record = label_records(peer, labels_address).at(-1)
    expect(record?.unset).toEqual([])
    expect(record?.set).toHaveLength(4)
    expect(await labels_of(peer, first)).toEqual(['view/a', 'view/c'])
    expect(events.filter(({ type }) => type === 'track:added')).toEqual([])
    expect(events.filter(({ type }) => type === 'library:index-updated')).toHaveLength(1)

    // A malformed item fails the batch before any item applies.
    await expect(peer.change_labels_batch({ items: [{ track_id: first, add: ['x'] }, { track_id: second }] })).rejects.toMatchObject({ code: 'invalid' })
    expect(await labels_of(peer, first)).toEqual(['view/a', 'view/c'])
    // So does one whose label record would pass the §2.8.3 entry bound.
    const long = (index: number) => `${String(index).padStart(4, '0')}/${'x'.repeat(120)}`
    const items = Array.from({ length: 200 }, (_, index) => ({
      track_id: compute_track_id(`AQADbulk${index}`),
      add: Array.from({ length: 12 }, (_, label) => long(label))
    }))
    await expect(peer.change_labels_batch({ items })).rejects.toMatchObject({ code: 'invalid' })
    expect(entry_count(peer, labels_address)).toBe(before + 1)
  })

  test('under a capability a set and an unset follow its filter, and an item it does not authorise fails alone', async () => {
    const owner = await peers.start()
    const grantee = await peers.start()
    const address = owner.identity().own_address
    await grantee.link_library({ address, alias: 'shared' })
    const [track_id] = await own_tracks(owner, ['AQADgranted']) as [string]
    await owner.change_labels({ track_id, add: ['owner-label'], library_address: address })
    const capability = await owner.issue_capability({
      library_address: address,
      grantee: { type: 'key', key: grantee.identity().key_pair.public_key },
      actions: ['library.write_label'],
      filter: { type: 'prefix', field: 'label', prefix: 'friend/' }
    })
    const { capability_id } = capability
    await wait_until(async () => (await grantee.list_held_capabilities()).some((held) => held.capability_id === capability_id && held.status === 'active'))
    await wait_until(async () => (await labels_of(grantee, track_id, { library_addresses: [address] })).includes('owner-label'))

    const results = await grantee.change_labels_batch({
      items: [{ track_id, add: ['friend/a'] }, { track_id, remove: ['owner-label'] }, { track_id: UNHELD, add: ['friend/b'] }],
      library_address: address,
      capability_id
    })
    expect(results).toEqual([
      { track_id, status: 'updated', tags: ['friend/a', 'owner-label'] },
      { track_id, status: 'failed', error: { code: 'FORBIDDEN', message: expect.any(String) } },
      { track_id: UNHELD, status: 'updated', tags: ['friend/b'] }
    ])
    // An unset under the capability: the filter sees the pair with op unset.
    expect(tags_of(await grantee.remove_tag({ track_id, tag: 'friend/a', library_address: address, capability_id }))).not.toContain('friend/a')
    await expect(grantee.remove_tag({ track_id, tag: 'owner-label', library_address: address, capability_id })).rejects.toMatchObject({ code: 'forbidden' })
    await wait_until(async () => {
      const labels = await owner.list_library_labels({ address })
      return JSON.stringify(labels.items) === JSON.stringify([{ track_id: UNHELD, tags: ['friend/b'] }, { track_id, tags: ['owner-label'] }]
        .sort((a, b) => a.track_id < b.track_id ? -1 : 1))
    })
  })

  test('two writers\' concurrent sets on one track both survive', async () => {
    const owner = await peers.start()
    const grantee = await peers.start()
    const address = owner.identity().own_address
    await grantee.link_library({ address, alias: 'shared' })
    const [track_id] = await own_tracks(owner, ['AQADconcurrent']) as [string]
    const { capability_id } = await owner.issue_capability({
      library_address: address,
      grantee: { type: 'key', key: grantee.identity().key_pair.public_key },
      actions: ['library.write_label']
    })
    await wait_until(async () => (await grantee.list_held_capabilities()).some((held) => held.capability_id === capability_id && held.status === 'active'))

    await Promise.all([
      owner.change_labels({ track_id, add: ['from/owner'], library_address: address }),
      grantee.change_labels({ track_id, add: ['from/grantee'], library_address: address, capability_id })
    ])
    for (const peer of [owner, grantee]) {
      await wait_until(async () => JSON.stringify(await labels_of(peer, track_id, { library_addresses: [address], label_libraries: [address] })) ===
        JSON.stringify(['from/grantee', 'from/owner']))
    }
  })

  test('adoption sets the target\'s labels in a label record after the PUT, and appends nothing when they hold', async () => {
    const peer = await peers.start()
    const { own_address } = peer.identity()
    const { content_cid } = await stored_track({ content_store: peer.content_store, fingerprint: 'AQADadopted', audio: 'adopted' })

    const adopted = await peer.add_track({ content_cid, tags: ['tier/personal', 'view/a'] })
    expect(tags_of(adopted)).toEqual(['tier/personal', 'view/a'])
    expect(label_records(peer, own_address)).toHaveLength(1)
    const after_adopt = entry_count(peer, own_address)
    await peer.add_track({ content_cid, tags: ['view/a', 'tier/personal'] })
    await peer.add_track({ content_cid })
    expect(entry_count(peer, own_address)).toBe(after_adopt)
    expect(tags_of(await peer.add_track({ content_cid, tags: ['view/b'] }))).toEqual(['view/b'])
    expect(entry_count(peer, own_address)).toBe(after_adopt + 1)
  })

  test('§4.6.1 a selective policy reads the labels the holding library and every own library apply', async () => {
    const owner = await peers.start()
    const follower = await peers.start()
    const address = owner.identity().own_address
    const kept = await append_track({ peer: owner, fingerprint: 'AQADkept', audio: 'kept audio' })
    const skipped = await append_track({ peer: owner, fingerprint: 'AQADskipped', audio: 'skipped audio' })
    // The follower labels a track it does not hold yet, in its labels library.
    await follower.add_tag({ track_id: compute_track_id('AQADkept'), tag: 'keep' })
    await follower.link_library({ address, alias: null })
    await follower.set_replication_policy({ address, mode: 'selective', filter: { type: 'match', fields: { tags: 'keep' } } })
    await wait_until(() => follower.context.libraries.get(address)?.oplog.entries.size === entry_count(owner, address))
    await wait_until(async () => await follower.content_store.is_pinned(kept.audio_cid))
    await follower.context.libraries.pins_settled()
    expect(await follower.content_store.is_pinned(skipped.audio_cid)).toBe(false)
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
