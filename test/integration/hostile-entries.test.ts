// A hostile peer on the network serves entries for an honest peer's library.
// Every fetched entry passes AC verification (§3.5, §3.5.4) before it can
// merge. One the entry alone condemns, such as a bad signature, is abandoned
// at fetch and enqueues none of its children (§5.4.2); one whose authorisation
// needs its causal past (§3.5.9) is rejected at merge, once its next land.

import { afterEach, describe, expect, test } from 'bun:test'

import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { hash_signed_entry } from '#entry/signed.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { encode_heads_batches } from '#replication/messages.ts'
import { linear_dag, nth, traverse } from '#test/helpers/dag.ts'
import { content_cid_of, sign_raw, track_put } from '#test/helpers/library.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

describe('hostile entries', () => {
  test('entries by a non-writer or with a bad signature are rejected and never merged', async () => {
    const a = await peers.start()
    const b = await peers.start()
    const address = a.identity().own_address
    const { entry: honest } = await append_track({ peer: a, fingerprint: 'AQADhonest' })
    await b.link_library({ address, alias: null })
    await wait_until(() => b.context.libraries.get(address)?.oplog.entries.has(honest.hash) === true)

    const hostile_store = create_memory_content_store()
    const hostile = peers.network.join({ content_store: hostile_store })
    const writer = a.identity().key_pair
    const outsider = generate_key_pair()
    const unseen_child = content_cid_of({ unseen: true })
    const fields = (time: number, key_pair = writer, next = [honest.hash, unseen_child]) => ({
      id: address,
      payload: track_put({ fingerprint: `AQADforged${time}` }),
      next,
      clock: { id: key_pair.public_key, time }
    })
    // Validly signed, with a valid clock, by a key outside the write list.
    const unauthorised = sign_raw({ private_key: outsider.private_key, fields: fields(honest.entry.clock.time + 1, outsider, [honest.hash]) })
    // A listed writer's entry carrying the signature of another entry.
    const donor = sign_raw({ private_key: writer.private_key, fields: fields(11) })
    const bad_signature = hash_signed_entry({ ...sign_raw({ private_key: writer.private_key, fields: fields(12) }).entry, sig: donor.entry.sig })
    for (const forged of [unauthorised, bad_signature]) await hostile_store.put(forged.hash, forged.bytes)

    const replicator = b.context.replication?.get(address)
    for (const data of encode_heads_batches({ heads: [unauthorised.hash, bad_signature.hash] })) await hostile.pubsub.publish(address, data)
    await wait_until(() => replicator?.traversal.rejected.size === 1 && replicator.traversal.enqueued.has(unauthorised.hash))
    await replicator?.idle()
    expect(Object.fromEntries([...replicator?.traversal.rejected ?? []].map(([hash, { code }]) => [hash, code]))).toEqual({
      [bad_signature.hash]: 'invalid_signature'
    })
    expect([...(b.context.libraries.get(address)?.oplog.entries.keys() ?? [])]).toEqual([honest.hash])
    expect(replicator?.traversal.enqueued.has(unseen_child)).toBe(false)
    // The merge rejected the non-writer's entry, so nothing waits on it.
    const status = replicator?.status()
    expect(status?.total).toBe(status?.progress as number)
    expect(await b.content_store.is_pinned(unauthorised.hash)).toBe(false)
  })

  test('a block that is not the entry its CID names is rejected', async () => {
    const dag = await linear_dag(2)
    const first = nth(dag.entries, 0)
    const second = nth(dag.entries, 1)
    const { traversal, verified } = traverse({ chain: dag.chain, fetch: async (hash) => hash === second.hash ? first.bytes : undefined })
    traversal.enqueue([second.hash])
    await traversal.idle()
    expect(traversal.rejected.get(second.hash)?.code).toBe('cid_mismatch')
    expect(verified).toEqual([])
  })
})
