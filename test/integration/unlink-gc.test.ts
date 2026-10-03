// Unlinking a replicated library (§4.6, §5.4.4): replication stops, and only
// the CIDs no other held library pins are released.

import { afterEach, describe, expect, test } from 'bun:test'

import { pinned } from '#test/helpers/library-manager.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

describe('unlink and GC', () => {
  test('unlinking one of two libraries that share content keeps the shared content pinned', async () => {
    const a = await peers.start()
    const c = await peers.start()
    const b = await peers.start()
    // A and C hold the same track content; A also holds a track of its own.
    const shared_a = await append_track({ peer: a, fingerprint: 'AQADshared', audio: 'shared audio' })
    const shared_c = await append_track({ peer: c, fingerprint: 'AQADshared', audio: 'shared audio' })
    const unique_a = await append_track({ peer: a, fingerprint: 'AQADunique', audio: 'unique audio' })
    expect(shared_a.content_cid).toBe(shared_c.content_cid)
    const a_address = a.identity().own_address
    const c_address = c.identity().own_address
    for (const address of [a_address, c_address]) await b.link_library({ address, alias: null })
    const held = async (cids: string[]) => (await pinned(b.content_store, cids)).every(Boolean)
    await wait_until(async () => await held([shared_a.entry.hash, unique_a.entry.hash, shared_c.entry.hash, shared_a.content_cid, unique_a.content_cid]))
    const a_chain = b.context.libraries.get(a_address)?.chain.cids

    await b.unlink_library(a_address)
    expect(b.context.replication?.get(a_address)).toBeUndefined()
    expect(b.context.libraries.get(a_address)).toBeUndefined()
    expect(await pinned(b.content_store, [shared_a.entry.hash, unique_a.entry.hash, unique_a.content_cid, a_chain?.manifest as string]))
      .toEqual([false, false, false, false])
    expect(await pinned(b.content_store, [shared_c.content_cid, shared_c.entry.hash])).toEqual([true, true])
    // B left A's topic, so A's new entries never reach it.
    const b_id = (await b.get_settings()).peer_id
    expect(a.context.replication?.get(a_address)?.peer_ids()).not.toContain(b_id)
    const mark = peers.network.delivered.length
    const later = await append_track({ peer: a, fingerprint: 'AQADlater' })
    await wait_until(() => peers.network.published.some(({ topic, data }) => topic === a_address && new TextDecoder().decode(data).includes(later.entry.hash)))
    expect(peers.network.delivered.slice(mark).some(({ to, topic }) => to === b_id && topic === a_address)).toBe(false)
  })
})
