// The listens library replicates like a recordstore (§2.7, §6.5), and a DEL
// fetched for it is rejected at verification, never merged. Listens sharing a
// clientListenId count once on every device and after a rebuild (§2.7).

import { afterEach, describe, expect, test } from 'bun:test'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { build_del_operation } from '#entry/operations.ts'
import { validate_listen_payload } from '#entry/listen.ts'
import { compare_bytes } from '#oplog/current-state.ts'
import { record_listen } from '#peer/listens.ts'
import type { Peer } from '#peer/peer.ts'
import { rebuild_query_db } from '#query-db/rebuild.ts'
import { open_query_db } from '#query-db/schema.ts'
import { get_listen_count } from '#query-db/queries.ts'
import { encode_heads_batches } from '#replication/messages.ts'
import { sign_raw } from '#test/helpers/library.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const append_keyed_listen = async (peer: Peer, { track_id, library_address, listened_at_ms, client_listen_id }: {
  track_id: string, library_address: string, listened_at_ms: number, client_listen_id: string
}) => {
  const { listens_address, key_pair } = peer.identity()
  await record_listen({ libraries: peer.context.libraries, listens_address, key_pair, track_id, address: library_address, timestamp: listened_at_ms, client_listen_id })
}

describe('listens replication', () => {
  test('listen entries replicate with their payloads, and a DEL is rejected', async () => {
    const a = await peers.start()
    const b = await peers.start()
    const { own_address, listens_address, key_pair } = a.identity()
    const { entry: track } = await append_track({ peer: a, fingerprint: 'AQADlistened' })
    const track_id = (track.operation as { key: string }).key
    await a.record_listen({ track_id, library_address: own_address })
    await a.record_listen({ track_id, library_address: own_address })
    const source = a.context.libraries.get(listens_address)?.oplog
    if (source === undefined) throw new Error('listens library not open')

    await b.link_library({ address: listens_address, alias: null })
    const replica = () => b.context.libraries.get(listens_address)?.oplog
    await wait_until(() => replica()?.entries.size === 2)
    expect([...(replica()?.heads ?? [])]).toEqual([...source.heads])
    for (const entry of replica()?.entries.values() ?? []) {
      expect(validate_listen_payload(entry.operation)).toMatchObject({ trackId: track_id, address: own_address })
    }

    // A DEL validly signed by the listens library's own writer.
    const del = sign_raw({
      private_key: key_pair.private_key,
      fields: { id: listens_address, payload: build_del_operation({ key: track_id }), next: [...source.heads], clock: { id: key_pair.public_key, time: 99 } }
    })
    const hostile_store = create_memory_content_store()
    const hostile = peers.network.join({ content_store: hostile_store })
    await hostile_store.put(del.hash, del.bytes)
    for (const data of encode_heads_batches({ heads: [del.hash] })) await hostile.pubsub.publish(listens_address, data)
    const replicator = b.context.replication?.get(listens_address)
    await wait_until(() => replicator?.traversal.rejected.has(del.hash) === true)
    expect(replicator?.traversal.rejected.get(del.hash)?.code).toBe('invalid_operation')
    expect(replica()?.entries.size).toBe(2)
  })

  test('a listen keeps its client time, and a repeated client_listen_id appends nothing', async () => {
    const peer = await peers.start()
    const { own_address, listens_address } = peer.identity()
    const listened_at_ms = Date.now() - 2 * 24 * 60 * 60 * 1000
    const listen = { track_id: 'f'.repeat(64), library_address: own_address, listened_at_ms, client_listen_id: 'listen-1' }
    const expected = { track_id: listen.track_id, count: 1, timestamps_ms: [listened_at_ms] }
    expect(await peer.record_listen(listen)).toEqual(expected)
    expect(await peer.record_listen(listen)).toEqual(expected)
    expect(peer.context.libraries.get(listens_address)?.oplog.entries.size).toBe(1)
  })

  test('two devices sending one client_listen_id count it once, on both and after a rebuild', async () => {
    const first = await peers.start()
    const second = await peers.start()
    await second.import_identity({ private_key: (await first.export_identity()).private_key })
    const { own_address, listens_address } = first.identity()
    expect(second.identity().listens_address).toBe(listens_address)
    const track_id = 'e'.repeat(64)
    const listened_at_ms = Date.now() - 60 * 60 * 1000
    const listen = { track_id, library_address: own_address, listened_at_ms, client_listen_id: 'listen-raced' }
    // Each device appends past the write-time check, as when neither has seen
    // the other's entry yet; memory replication is otherwise fast enough that
    // the check catches the second write. The times differ by a millisecond,
    // since one key pair signing one payload on an empty log makes one entry.
    await Promise.all([
      append_keyed_listen(first, listen),
      append_keyed_listen(second, { ...listen, listened_at_ms: listened_at_ms + 1 })
    ])
    const size = (peer: Peer) => peer.context.libraries.get(listens_address)?.oplog.entries.size ?? 0
    await wait_until(() => size(first) === 2 && size(second) === 2)
    const entries = [...(first.context.libraries.get(listens_address)?.oplog.entries.values() ?? [])]
    const winner = entries.sort((x, y) => compare_bytes(x.multihash, y.multihash))[0]!
    const winner_ms = (winner.operation as { timestamp: number }).timestamp
    const kept = (db: typeof first.db) => db.prepare('SELECT entry_hash FROM listens WHERE client_listen_id IS NOT NULL').all()
    for (const peer of [first, second]) {
      await peer.context.replication?.settled(listens_address)
      await peer.context.libraries.settled()
      expect(get_listen_count({ db: peer.db, track_id })).toEqual({ track_id, count: 1, timestamps_ms: [winner_ms] })
      expect(kept(peer.db)).toEqual([{ entry_hash: winner.hash }])
    }

    // A rebuild replays in block order, so run it in both.
    for (const reverse of [false, true]) {
      const rebuilt = open_query_db()
      const { rejected } = await rebuild_query_db({
        db: rebuilt,
        libraries: second.context.libraries.list().map(({ chain, oplog }) => {
          const blocks = [...oplog.entries.values()].map(({ bytes }) => bytes)
          return { chain, blocks: reverse ? blocks.reverse() : blocks }
        }),
        read_content: second.content_store.get
      })
      expect(rejected).toEqual([])
      expect(get_listen_count({ db: rebuilt, track_id }).count).toBe(1)
      expect(kept(rebuilt)).toEqual([{ entry_hash: winner.hash }])
      rebuilt.close()
    }
  })
})
