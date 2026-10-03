// Library announcements on RECORD (§5.3.2, §5.3.3), against
// src/replication/announcement.ts and src/replication/messages.ts, and
// between peers on the in-memory network.

import { afterEach, describe, expect, test } from 'bun:test'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { compute_about_id } from '#entry/id.ts'
import { RECORD_TOPIC, type PubSubMessage } from '#fabric/pubsub.ts'
import { get_live_entry } from '#oplog/dag.ts'
import type { Peer } from '#peer/peer.ts'
import { authenticate_announced, create_announcer } from '#replication/announcement.ts'
import {
  build_loaded_about_entry,
  decode_announcement,
  encode_announcement,
  NETWORK_MESSAGE_MAX_BYTES,
  type LoadedAboutEntry
} from '#replication/messages.ts'
import { append_track, create_memory_peers, wait_for_event, wait_until } from '#test/helpers/network.ts'
import { create_manual_timers } from '#test/helpers/timers.ts'
import { loaded_about_entry_vector } from './vectors.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const turn = async () => { await new Promise((resolve) => setImmediate(resolve)) }

const vector_about = loaded_about_entry_vector.message as unknown as LoadedAboutEntry
const with_content = (hint: LoadedAboutEntry, content: Record<string, unknown>): LoadedAboutEntry =>
  ({ ...hint, payload: { ...hint.payload, value: { ...hint.payload.value, content } } })

const peer_id_of = async (peer: Peer) => (await peer.get_settings()).peer_id

// A started peer with an About entry, and its announced form.
const announcing_peer = async (name: string) => {
  const peer = await peers.start()
  const address = peer.identity().own_address
  await peer.set_about({ address, fields: { name } })
  const entry = get_live_entry({ oplog: peer.context.libraries.get(address)?.oplog as never, key: compute_about_id(address) })
  if (entry === undefined) throw new Error('no About entry')
  const hint = build_loaded_about_entry({ hash: entry.hash, entry: entry.entry, about_content: { address, name } })
  return { peer, address, hint }
}

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
    const { peer, address, hint } = await announcing_peer('A')
    const peer_id = await peer_id_of(peer)
    const { received } = await join_observer()
    await wait_until(() => received.some(({ from }) => from === peer_id))
    const message = JSON.parse(decoder.decode(received.find(({ from }) => from === peer_id)?.data)) as { about: LoadedAboutEntry, logs: unknown[] }
    expect(message.about).toEqual(JSON.parse(JSON.stringify(hint)))
    expect(message.about.payload.value.content).toEqual({ address, name: 'A' })
    expect(message.logs).toEqual([])
  })

  test('§5.3.2 [MUST] an announced about entry is authenticated only after re-fetching the canonical entry by hash', async () => {
    const { peer, address, hint } = await announcing_peer('A')
    const fetched: string[] = []
    const get_block = async (cid: string) => {
      fetched.push(cid)
      return await peer.content_store.get(cid)
    }
    expect((await authenticate_announced({ announced: { address, hint }, get_block }))?.content).toEqual({ address, name: 'A' })
    expect(fetched).toContain(hint.hash)
    // The inlined content is checked against the payload the canonical entry names.
    const tampered = with_content(hint, { address, name: 'Mallory' })
    expect(await authenticate_announced({ announced: { address, hint: tampered }, get_block })).toBeUndefined()
    // Without the canonical entry there is nothing to authenticate.
    const without_entry = async (cid: string) => cid === hint.hash ? undefined : await peer.content_store.get(cid)
    expect(await authenticate_announced({ announced: { address, hint }, get_block: without_entry })).toBeUndefined()
  })

  test('§5.3.2 [MUST] announcements over 256 KiB of JSON are not sent', async () => {
    const padded = (bytes: number) => with_content(vector_about, { ...vector_about.payload.value.content, bio: 'x'.repeat(bytes) })
    const logs = Array.from({ length: 4 }, () => padded(100 * 1024))
    const bytes = encode_announcement({ about: vector_about, logs })
    expect(bytes?.length).toBeLessThanOrEqual(NETWORK_MESSAGE_MAX_BYTES)
    // Linked logs that do not fit are left out; the about entry stays.
    const sent = JSON.parse(decoder.decode(bytes)) as { about: unknown, logs: unknown[] }
    expect(sent.about).toEqual(JSON.parse(JSON.stringify(vector_about)))
    expect(sent.logs).toHaveLength(2)
    // An about entry over the bound alone is never sent.
    expect(encode_announcement({ about: padded(NETWORK_MESSAGE_MAX_BYTES), logs: [] })).toBeUndefined()
    const network = peers.network
    const member = network.join({ content_store: create_memory_content_store() })
    const timers = create_manual_timers()
    const announcer = create_announcer({ pubsub: member.pubsub, interval_ms: 5000, timers, build: async () => encode_announcement({ about: padded(NETWORK_MESSAGE_MAX_BYTES), logs: [] }) })
    announcer.announce_self()
    announcer.peer_joined('peer')
    timers.advance(0)
    await turn()
    expect(record_messages_from(member.peer_id)).toEqual([])
  })

  test('§5.3.2 [MUST] received announcements over 256 KiB are dropped unprocessed', async () => {
    const oversized = encoder.encode(JSON.stringify({ about: vector_about, logs: [], padding: 'x'.repeat(NETWORK_MESSAGE_MAX_BYTES) }))
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
    const within = encoder.encode(JSON.stringify({ about: vector_about, logs: [] }))
    await member.pubsub.publish(RECORD_TOPIC, within)
    await wait_until(() => delivered(within))
    expect(receiver.context.replication?.announced_by(member.peer_id)?.hints.map(({ address }) => address))
      .toEqual([vector_about.payload.value.content.address as string])
  })

  test('§5.3.2 [MUST] announcement content is an untrusted hint until the AC chain and signatures verify', async () => {
    const { peer: genuine, address, hint } = await announcing_peer('A')
    const receiver = await peers.start()
    const { member: hostile } = await join_observer()
    // A hostile peer announces the genuine library with forged content.
    await hostile.pubsub.publish(RECORD_TOPIC, encoder.encode(JSON.stringify({ about: with_content(hint, { address, name: 'Mallory' }), logs: [] })))
    const genuine_id = await peer_id_of(genuine)
    await wait_until(() => receiver.context.replication?.announced_by(genuine_id)?.verified.has(address) === true)
    await wait_until(() => receiver.context.replication?.announced_by(hostile.peer_id) !== undefined)
    await turn()
    const hostile_record = receiver.context.replication?.announced_by(hostile.peer_id)
    expect(hostile_record?.hints.map(({ address }) => address)).toEqual([address])
    expect([...(hostile_record?.verified ?? [])]).toEqual([])
    // Hints change nothing local: no library opens, no About is indexed.
    expect(receiver.context.libraries.get(address)).toBeUndefined()
    expect(await receiver.get_about(address)).toBeUndefined()
    const listed = await receiver.list_peers()
    expect(listed.find(({ peer_id }) => peer_id === hostile.peer_id)?.library_addresses).toEqual([])
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
    await a.set_about({ address, fields: { name: 'A2' } })
    await added
    await wait_until(() => peers.network.published.some(({ from, topic }) => from === a_id && topic === address))
    expect(record_messages_from(a_id)).toHaveLength(announced)
  })

  test('§5.3.3 [MUST] a missing announcement is not taken to mean the library does not exist', async () => {
    // A has no About entry, so it never announces.
    const a = await peers.start()
    const b = await peers.start()
    const address = a.identity().own_address
    await append_track({ peer: a, fingerprint: 'AQADsilent' })
    const added = wait_for_event(b, ({ type, payload }) => type === 'track:added' && payload.library_address === address)
    await b.link_library({ address, alias: null })
    await added
    expect(record_messages_from(await peer_id_of(a))).toEqual([])
    expect((await b.get_library(address))?.is_linked).toBe(true)
  })
})
