// The identity library on a peer (§4.6.2, §4.8.3 to §4.8.5): own libraries
// recorded, created, and retired; links recorded and replicated across the
// identity's devices; v1.0 Log links carried over; and pins kept on every
// device.

import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { build_log_envelope } from '#entry/envelope.ts'
import { canonical_cid } from '#entry/identity-record.ts'
import { compute_log_id } from '#entry/id.ts'
import { build_put_operation } from '#entry/operations.ts'
import { get_live_entry } from '#oplog/dag.ts'
import type { Peer } from '#peer/peer.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

// A second device of the peer's identity.
const second_device = async (peer: Peer): Promise<Peer> => {
  const device = await peers.start()
  await device.import_identity({ private_key: (await peer.export_identity()).private_key })
  return device
}

const records = async (peer: Peer, type?: string) =>
  (await peer.read_meta_log({ offset: 0, limit: 100, type, current_only: true })).items

describe('identity library', () => {
  test('§4.8.3 [MUST] a new identity records its own recordstore and listens libraries, and GET /identity names them', async () => {
    const peer = await peers.start()
    const { own_address, listens_address, identity_address, key_pair } = peer.identity()
    expect((await records(peer, 'library')).map(({ record }) => record.address).sort()).toEqual([own_address, listens_address].sort())
    expect(await peer.get_identity()).toEqual({ public_key: key_pair.public_key, meta_log_address: identity_address, own_library_address: own_address })
    const own = await peer.list_own_libraries()
    expect(own.map(({ address, library_type }) => [address, library_type]).sort())
      .toEqual([[own_address, 'recordstore'], [listens_address, 'listens']].sort())
    expect((await peer.list_libraries()).some(({ address }) => address === identity_address)).toBe(false)
  })

  test('§4.8.3 [MUST] an own library is created and retired for good, and a retired one refuses writes', async () => {
    const peer = await peers.start()
    const { entry } = await append_track({ peer, fingerprint: 'AQADretire' })
    const track_id = (entry.operation as { key: string }).key
    const mixes = await peer.create_own_library({ discriminator: 'mixes', about: { name: 'Mixes' } })
    expect(mixes).toMatchObject({ is_own: true, is_retired: false, library_type: 'recordstore', name: 'Mixes', replication_mode: 'full' })
    // Two active own recordstores: a write must name its target.
    await expect(peer.add_tag({ track_id, tag: 'x' })).rejects.toMatchObject({ code: 'invalid' })
    expect((await peer.add_tag({ track_id, tag: 'x', library_address: peer.identity().own_address })).tags).toContainEqual({ library_address: peer.identity().own_address, tag: 'x' })

    await peer.retire_own_library(mixes.address)
    expect(await peer.get_library(mixes.address)).toMatchObject({ is_own: true, is_retired: true })
    await expect(peer.set_about({ address: mixes.address, fields: { name: 'again' } })).rejects.toMatchObject({ code: 'conflict' })
    await expect(peer.create_own_library({ discriminator: 'mixes' })).rejects.toMatchObject({ code: 'conflict' })
    // One active recordstore again, so it is the default target.
    expect((await peer.add_tag({ track_id, tag: 'y' })).tags).toContainEqual({ library_address: peer.identity().own_address, tag: 'y' })
    await expect(peer.retire_own_library(peer.identity().listens_address)).rejects.toMatchObject({ code: 'conflict' })
  })

  test('§4.8.5 [MUST] links replicate across the identity\'s devices, and an unlink on one drops the replica on the other', async () => {
    const first = await peers.start()
    const friend = await peers.start()
    await append_track({ peer: friend, fingerprint: 'AQADfriend' })
    const address = friend.identity().own_address
    const second = await second_device(first)
    expect(second.identity().identity_address).toBe(first.identity().identity_address)

    await first.link_library({ address, alias: 'friend' })
    await wait_until(async () => (await second.get_library(address))?.is_linked === true)
    expect(await second.get_library(address)).toMatchObject({ alias: 'friend', replication_mode: 'full' })
    await wait_until(() => (second.context.libraries.get(address)?.oplog.entries.size ?? 0) > 0)

    await second.unlink_library(address)
    await wait_until(async () => await first.get_library(address) === undefined)
    await wait_until(() => first.context.libraries.get(address) === undefined)
    expect(await first.content_store.is_pinned(address.split('/')[2] as string)).toBe(false)
  })

  test('§4.8.4 [MUST] a v1.0 Log entry links an address no link record names, as index_only; a link record then decides', async () => {
    const peer = await peers.start()
    const friend = await peers.start()
    const address = friend.identity().own_address
    const { key_pair, own_address } = peer.identity()
    const content = encode_canonical({ address, alias: 'old' })
    const content_cid = compute_cid_string(content)
    await peer.content_store.put(content_cid, content)
    await peer.context.libraries.append({
      library_address: own_address,
      payload: build_put_operation({ envelope: build_log_envelope({ id: compute_log_id(address), content_cid }) }),
      key_pair
    })
    await wait_until(async () => (await peer.get_library(address))?.is_linked === true)
    expect(await peer.get_library(address)).toMatchObject({ alias: 'old', replication_mode: 'index_only' })

    // Unlinking records a link DEL and a Log DEL, so v1.0 peers see it too.
    await peer.unlink_library(address)
    expect(await peer.get_library(address)).toBeUndefined()
    const own = peer.context.libraries.get(own_address)?.oplog
    expect(own === undefined ? undefined : get_live_entry({ oplog: own, key: compute_log_id(address) })).toBeUndefined()
    expect((await records(peer, 'link')).map(({ op }) => op)).toEqual(['DEL'])

    await peer.link_library({ address, alias: 'new' })
    expect(await peer.get_library(address)).toMatchObject({ alias: 'new', replication_mode: 'full' })
  })

  test('§4.6.2 [MUST] a pin record keeps its blob on every device of the identity, and an unpin releases it', async () => {
    const first = await peers.start()
    const holder = await peers.start()
    const cid = await holder.content_store.import_blob(randomBytes(4096))
    const second = await second_device(first)

    await first.pin_track(cid)
    expect((await records(first, 'pin')).map(({ record }) => record.cid)).toEqual([canonical_cid(cid)])
    for (const device of [first, second]) {
      await wait_until(async () => await device.content_store.is_pinned(cid))
    }
    await expect(first.unpin_track('not a cid')).rejects.toMatchObject({ code: 'invalid' })

    await second.unpin_track(cid)
    for (const device of [first, second]) {
      await wait_until(async () => !await device.content_store.is_pinned(cid))
    }
    await expect(first.unpin_track(cid)).rejects.toMatchObject({ code: 'not_found' })
  })
})
