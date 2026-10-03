// The listens library replicates like a recordstore (§2.7, §6.5), and a DEL
// fetched for it is rejected at verification, never merged.

import { afterEach, describe, expect, test } from 'bun:test'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { build_del_operation } from '#entry/operations.ts'
import { validate_listen_payload } from '#entry/listen.ts'
import { encode_heads_batches } from '#replication/messages.ts'
import { sign_raw } from '#test/helpers/library.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

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
      fields: { id: listens_address, payload: build_del_operation({ key: track_id, type: 'track' }), next: [...source.heads], clock: { id: key_pair.public_key, time: 99 } }
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
})
