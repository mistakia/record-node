// Library announcements on RECORD (§5.3.2, §5.3.3), against
// src/replication/announcement.ts and src/replication/messages.ts, and
// between peers on the in-memory network.

import { afterEach, describe, expect, test } from 'bun:test'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { ABOUT_KEY } from '#entry/records.ts'
import { RECORD_TOPIC, type PubSubMessage } from '#fabric/pubsub.ts'
import { get_live_entry } from '#oplog/dag.ts'
import type { Peer } from '#peer/peer.ts'
import { create_announcer, verify_announced_library, verify_announced_profile } from '#replication/announcement.ts'
import {
  announced_entry,
  decode_announcement,
  encode_announcement,
  NETWORK_MESSAGE_MAX_BYTES,
  type Announcement
} from '#replication/messages.ts'
import type { SignedEntry } from '#types/entry.ts'
import { append_track, create_memory_peers, wait_for_event, wait_until } from '#test/helpers/network.ts'
import { create_manual_timers } from '#test/helpers/timers.ts'
import { announced_about_vector, announced_profile_vector } from './vectors.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const turn = async () => { await new Promise((resolve) => setImmediate(resolve)) }

const vector_about = announced_about_vector.entry as unknown as SignedEntry
const vector_address = announced_about_vector.entry.id
const with_value = (entry: SignedEntry, value: Record<string, unknown>): SignedEntry =>
  ({ ...entry, payload: { ...entry.payload as Record<string, unknown>, value: { ...(entry.payload as { value: Record<string, unknown> }).value, ...value } } })

const peer_id_of = async (peer: Peer) => (await peer.get_settings()).peer_id

// A started peer with an About entry and a profile, and their announced forms.
const announcing_peer = async (name: string) => {
  const peer = await peers.start()
  const address = peer.identity().own_address
  await peer.set_about({ address, name })
  await peer.set_profile({ name: `${name} person` })
  const entry = get_live_entry({ oplog: peer.context.libraries.get(address)?.oplog as never, key: ABOUT_KEY })
  if (entry === undefined) throw new Error('no About entry')
  return { peer, address, about: announced_entry(entry.entry) }
}

const message_of = (announcement: Announcement): Uint8Array => encoder.encode(JSON.stringify(announcement))

// A bare network member listening on RECORD.
const join_observer = async () => {
  const member = peers.network.join({ content_store: create_memory_content_store() })
  const received: PubSubMessage[] = []
  await member.pubsub.subscribe(RECORD_TOPIC, (message) => { received.push(message) })
  return { member, received }
}

const record_messages_from = (peer_id: string) =>
  peers.network.published.filter(({ from, topic }) => from === peer_id && topic === RECORD_TOPIC)

describe('announcement', () => {
  test('§5.3.2 [MUST] announcements are JSON-encoded and published via pubsub', async () => {
    const { peer, address, about } = await announcing_peer('A')
    const peer_id = await peer_id_of(peer)
    const { received } = await join_observer()
    await wait_until(() => received.some(({ from }) => from === peer_id))
    const message = JSON.parse(decoder.decode(received.find(({ from }) => from === peer_id)?.data)) as Announcement
    // The own recordstore only: never the identity, listens or labels library.
    expect(message.libraries).toEqual([{ address, about: JSON.parse(JSON.stringify(about)) }])
    expect(message.libraries[0]?.about?.payload).toMatchObject({ value: { type: 'about', v: 1, name: 'A' } })
    expect(message.profiles).toHaveLength(1)
    expect(message.profiles[0]).toMatchObject({ id: peer.identity().identity_address, payload: { value: { type: 'profile', name: 'A person' } } })
  })

  test('§5.3.2 [MUST] announced entries verify from the JSON alone, under the trust checks', async () => {
    const { peer, address, about } = await announcing_peer('A')
    const fetched: string[] = []
    const get_block = async (cid: string) => {
      fetched.push(cid)
      return await peer.content_store.get(cid)
    }
    const verified = await verify_announced_library({ announced: { address, about }, get_block })
    expect(verified?.about?.record.name).toBe('A')
    // Only the AC chain is read; the entry itself is never fetched.
    expect(fetched).not.toContain(verified?.about?.hashed.hash)
    // A tampered About fails its signature, and one naming another library is
    // not this library's; either is ignored and the library still resolves.
    expect((await verify_announced_library({ announced: { address, about: with_value(about, { name: 'Mallory' }) }, get_block }))?.about).toBeUndefined()
    expect((await verify_announced_library({ announced: { address, about: { ...about, id: vector_address } }, get_block }))?.about).toBeUndefined()
    // A profile verifies only when signed and filed in its own key's identity library.
    const profile = announced_profile_vector.entry as unknown as SignedEntry
    expect(verify_announced_profile(profile)?.record.name).toBe('Test')
    expect(verify_announced_profile(with_value(profile, { name: 'Mallory' }))).toBeUndefined()
    expect(verify_announced_profile({ ...profile, id: vector_address })).toBeUndefined()
  })

  test('§5.3.2 [MUST] announcements over 256 KiB of JSON are not sent', async () => {
    const padded = (bytes: number) => with_value(vector_about, { name: 'x'.repeat(bytes) })
    const linked = Array.from({ length: 4 }, (_, index) => ({ address: `${vector_address}${index}`, about: padded(100 * 1024) }))
    const bytes = encode_announcement({ libraries: [{ address: vector_address, about: vector_about }, ...linked], profiles: [], own_count: 1 })
    expect(bytes?.length).toBeLessThanOrEqual(NETWORK_MESSAGE_MAX_BYTES)
    // Linked libraries that do not fit are left out; the own library stays.
    const sent = JSON.parse(decoder.decode(bytes)) as Announcement
    expect(sent.libraries[0]).toEqual(JSON.parse(JSON.stringify({ address: vector_address, about: vector_about })))
    expect(sent.libraries).toHaveLength(3)
    // A profile goes with the last library its owner announces.
    const owned = encode_announcement({
      libraries: [{ address: vector_address }, { address: `${vector_address}x`, about: padded(NETWORK_MESSAGE_MAX_BYTES) }],
      profiles: [announced_profile_vector.entry as unknown as SignedEntry, { ...vector_about, key: 'other' } as unknown as SignedEntry],
      own_count: 1,
      owners: new Map([[vector_address, announced_profile_vector.entry.key], [`${vector_address}x`, 'other']])
    })
    expect((JSON.parse(decoder.decode(owned)) as Announcement).profiles.map(({ key }): string => key)).toEqual([announced_profile_vector.entry.key])
    // Own libraries over the bound are never sent.
    const oversized = () => encode_announcement({ libraries: [{ address: vector_address, about: padded(NETWORK_MESSAGE_MAX_BYTES) }], profiles: [], own_count: 1 })
    expect(oversized()).toBeUndefined()
    const network = peers.network
    const member = network.join({ content_store: create_memory_content_store() })
    const timers = create_manual_timers()
    const announcer = create_announcer({ pubsub: member.pubsub, interval_ms: 5000, timers, build: async () => oversized() })
    announcer.announce_self()
    announcer.peer_joined('peer')
    timers.advance(0)
    await turn()
    expect(record_messages_from(member.peer_id)).toEqual([])
  })

  test('§5.3.2 [MUST] received announcements over 256 KiB are dropped unprocessed', async () => {
    const libraries = [{ address: vector_address, about: vector_about }]
    const oversized = encoder.encode(JSON.stringify({ libraries, profiles: [], padding: 'x'.repeat(NETWORK_MESSAGE_MAX_BYTES) }))
    expect(oversized.length).toBeGreaterThan(NETWORK_MESSAGE_MAX_BYTES)
    expect(decode_announcement(oversized)).toBeUndefined()
    const receiver = await peers.start()
    const receiver_id = await peer_id_of(receiver)
    const { member } = await join_observer()
    const delivered = (data: Uint8Array) => peers.network.delivered.some(({ to, data: sent }) => to === receiver_id && sent === data)
    await member.pubsub.publish(RECORD_TOPIC, oversized)
    await wait_until(() => delivered(oversized))
    expect(receiver.context.replication?.announced_by(member.peer_id)).toBeUndefined()
    // The same announcement within the bound is processed.
    const within = message_of({ libraries, profiles: [] })
    await member.pubsub.publish(RECORD_TOPIC, within)
    await wait_until(() => delivered(within))
    expect(receiver.context.replication?.announced_by(member.peer_id)?.hints.map(({ address }) => address)).toEqual([vector_address])
  })

  test('§5.3.2 [MUST] announcement content is an untrusted hint until its signatures and the AC chain verify', async () => {
    const { peer: genuine, address, about } = await announcing_peer('A')
    const genuine_key = genuine.identity().key_pair.public_key
    const receiver = await peers.start()
    const { member: hostile } = await join_observer()
    // A hostile peer announces the genuine library with a forged About and owner profile.
    const own_profile = get_live_entry({ oplog: genuine.context.libraries.get(genuine.identity().identity_address)?.oplog as never, key: `profile:${announced_profile_vector.entry.payload.key}` })
    const forged_profile = with_value(announced_entry(own_profile?.entry as SignedEntry), { name: 'Mallory' })
    await hostile.pubsub.publish(RECORD_TOPIC, message_of({ libraries: [{ address, about: with_value(about, { name: 'Mallory' }) }], profiles: [forged_profile] }))
    // An unresolvable library is never verified.
    const unknown = `${address.slice(0, -'library'.length)}nowhere`
    await hostile.pubsub.publish(RECORD_TOPIC, message_of({ libraries: [{ address: unknown }], profiles: [] }))
    const genuine_id = await peer_id_of(genuine)
    await wait_until(() => receiver.context.replication?.announced_by(genuine_id)?.verified.has(address) === true)
    await wait_until(() => receiver.context.replication?.announced_by(hostile.peer_id) !== undefined)
    await turn()
    expect(receiver.context.replication?.announced_by(hostile.peer_id)?.verified.has(unknown)).toBe(false)
    // Only the genuine profile is kept as the owner's.
    await wait_until(() => receiver.context.announced.profiles.get(genuine_key) !== undefined)
    expect(receiver.context.announced.profiles.get(genuine_key)?.record.name).toBe('A person')
    expect(await receiver.get_library_profile(address)).toEqual({ public_key: genuine_key, name: 'A person', bio: null, avatar: null })
    // Hints change nothing local: no library opens, no About is indexed.
    expect(receiver.context.libraries.get(address)).toBeUndefined()
    expect(await receiver.get_about(address)).toBeUndefined()
    const listed = await receiver.list_peers()
    expect(listed.find(({ peer_id }) => peer_id === genuine_id)?.library_addresses).toEqual([address])
  })

  test('§5.3.3 [MUST] at most one announcement per RECORD peer-join per 5 seconds per target peer', async () => {
    const member = peers.network.join({ content_store: create_memory_content_store() })
    const timers = create_manual_timers()
    const announcer = create_announcer({ pubsub: member.pubsub, interval_ms: 5000, timers, build: async () => encoder.encode('{}') })
    const sent = async () => {
      timers.advance(0)
      await turn()
      return record_messages_from(member.peer_id).length
    }
    announcer.peer_joined('p')
    expect(await sent()).toBe(1)
    timers.advance(1000)
    announcer.peer_joined('p')
    expect(await sent()).toBe(1)
    timers.advance(3999)
    announcer.peer_joined('p')
    expect(await sent()).toBe(1)
    timers.advance(1)
    announcer.peer_joined('p')
    expect(await sent()).toBe(2)
    // Simultaneous joins batch into one announcement.
    announcer.peer_joined('q')
    announcer.peer_joined('r')
    expect(await sent()).toBe(3)
  })

  test('§5.3.3 [MUST] library state changes are not re-announced on RECORD', async () => {
    const { peer: a, address } = await announcing_peer('A')
    const a_id = await peer_id_of(a)
    const b = await peers.start()
    await wait_until(() => record_messages_from(a_id).length > 0)
    const announced = record_messages_from(a_id).length
    const added = wait_for_event(b, ({ type, payload }) => type === 'track:added' && payload.library_address === address)
    await b.link_library({ address, alias: null })
    await append_track({ peer: a, fingerprint: 'AQADstate' })
    await a.set_about({ address, name: 'A2' })
    await added
    await wait_until(() => peers.network.published.some(({ from, topic }) => from === a_id && topic === address))
    expect(record_messages_from(a_id)).toHaveLength(announced)
  })

  test('§5.3.3 [MUST] a missing announcement is not taken to mean the library does not exist', async () => {
    // A never announces.
    const a = await peers.start({ config: { announce: false } })
    const b = await peers.start()
    const address = a.identity().own_address
    await append_track({ peer: a, fingerprint: 'AQADsilent' })
    const added = wait_for_event(b, ({ type, payload }) => type === 'track:added' && payload.library_address === address)
    await b.link_library({ address, alias: null })
    await added
    expect(record_messages_from(await peer_id_of(a))).toEqual([])
    expect((await b.get_library(address))?.is_linked).toBe(true)
  })

  // Not part of the spec: the node config that keeps an own library unannounced.
  test('a peer with announce off announces nothing, even with an About entry', async () => {
    const quiet = await peers.start({ config: { announce: false } })
    await quiet.set_about({ address: quiet.identity().own_address, name: 'Q' })
    const { peer: loud } = await announcing_peer('L')
    const { received } = await join_observer()
    const loud_id = await peer_id_of(loud)
    await wait_until(() => received.some(({ from }) => from === loud_id))
    expect(record_messages_from(await peer_id_of(quiet))).toEqual([])
  })
})
