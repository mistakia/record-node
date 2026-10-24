// The identity library on a peer (§4.6, §4.6.2, §4.8.2 to §4.8.5): own
// libraries recorded, created, and retired; links recorded and replicated
// across the identity's devices; pins kept on every device; and the profile
// and its avatar.

import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { derive_library_address } from '#encoding/library-address.ts'
import { build_identity_put, canonical_cid } from '#entry/identity-record.ts'
import { generate_key_pair } from '#identity/key-pair.ts'
import { data_paths } from '#peer/config.ts'
import { save_key_pair } from '#peer/identity.ts'
import { read_profile, write_profile } from '#peer/identity-library.ts'
import { create_peer, stop_peer, type Peer } from '#peer/peer.ts'
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
  test('§4.8.3 [MUST] a new identity records a recordstore, a listens and a labels library, and GET /identity names the recordstore', async () => {
    const peer = await peers.start()
    const { own_address, listens_address, labels_address, identity_address, key_pair } = peer.identity()
    expect((await records(peer, 'library')).map(({ record }) => record.address).sort()).toEqual([own_address, listens_address, labels_address].sort())
    expect(await peer.get_identity()).toEqual({ public_key: key_pair.public_key, meta_log_address: identity_address, own_library_address: own_address })
    const own = await peer.list_own_libraries()
    expect(own.map(({ address, library_type }) => [address, library_type]).sort())
      .toEqual([[own_address, 'recordstore'], [listens_address, 'listens'], [labels_address, 'labels']].sort())
    expect((await peer.list_libraries()).some(({ address }) => address === identity_address)).toBe(false)
    // §3.6.1: the listens and labels libraries take their initial
    // discriminators, the recordstore 26 random base32 characters.
    expect([listens_address, labels_address].map((address) => address.split('/')[3])).toEqual(['listens', 'labels'])
    expect(own_address.split('/')[3]).toMatch(/^[a-z2-7]{26}$/)
    // §4.8.3: neither the listens nor the labels library is ever retired.
    for (const address of [listens_address, labels_address]) {
      await expect(peer.retire_own_library(address)).rejects.toMatchObject({ code: 'conflict' })
    }
  })

  test('§4.8.3 [MUST] a reopened identity creates no library, and one from before the labels library gains one', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-reopen-'))
    const first = await peers.start({ config: { data_dir } })
    const before = (await records(first, 'library')).map(({ entry_hash }) => entry_hash).sort()
    const { own_address } = first.identity()
    await stop_peer(first)
    const reopened = await peers.start({ config: { data_dir } })
    expect((await records(reopened, 'library')).map(({ entry_hash }) => entry_hash).sort()).toEqual(before)
    expect(reopened.identity().own_address).toBe(own_address)

    // An identity whose identity library records a `record` recordstore and
    // a listens library only, as record-node 1.1 left it.
    const legacy_dir = mkdtempSync(join(tmpdir(), 'record-legacy-'))
    const key_pair = generate_key_pair()
    await save_key_pair({ path: data_paths(legacy_dir).identity, key_pair })
    const setup = await create_peer({ config: { data_dir: legacy_dir, network: false } })
    const write_keys = [key_pair.public_key]
    const identity = await setup.context.libraries.create_library({ name: 'identity', type: 'identity', write_keys })
    for (const [name, type] of [['record', 'recordstore'], ['listens', 'listens']] as const) {
      const { chain } = await setup.context.libraries.create_library({ name, type, write_keys })
      await setup.context.libraries.append({
        library_address: identity.chain.address, key_pair, payload: build_identity_put({ type: 'library', v: 1, timestamp: Date.now(), address: chain.address })
      })
    }
    await stop_peer(setup)
    const legacy = await peers.start({ config: { data_dir: legacy_dir } })
    const address_of = (type: 'recordstore' | 'listens' | 'labels', discriminator: string) => derive_library_address({ key: key_pair.public_key, type, discriminator })
    expect((await records(legacy, 'library')).map(({ record }) => record.address).sort())
      .toEqual([address_of('recordstore', 'record'), address_of('listens', 'listens'), address_of('labels', 'labels')].sort())
    expect(legacy.identity()).toMatchObject({ own_address: address_of('recordstore', 'record'), labels_address: address_of('labels', 'labels') })
  })

  test('chapter 7 [MUST] own_library_address is the oldest active own recordstore', async () => {
    const peer = await peers.start()
    const { own_address } = peer.identity()
    const second = await peer.create_own_library({})
    expect(second.address.split('/')[3]).toMatch(/^[a-z2-7]{26}$/)
    expect((await peer.get_identity()).own_library_address).toBe(own_address)
    await peer.retire_own_library(own_address)
    expect((await peer.get_identity()).own_library_address).toBe(second.address)
  })

  test('§4.8.2 [MUST] the profile is one record a later PUT replaces, and §4.6 its avatar is pinned on every device', async () => {
    const first = await peers.start()
    const second = await second_device(first)
    const avatar = await first.put_image(randomBytes(4096))
    expect(await write_profile(first.context, { name: 'Ada', avatar })).toMatchObject({ type: 'profile', name: 'Ada', avatar: canonical_cid(avatar) })
    await wait_until(async () => await second.content_store.is_pinned(avatar))
    expect(read_profile(second.context)).toMatchObject({ name: 'Ada', avatar: canonical_cid(avatar) })
    // A later PUT replaces the whole profile, and an unchanged one appends nothing.
    await write_profile(first.context, { bio: 'hello' })
    expect(read_profile(first.context)).toEqual(expect.objectContaining({ bio: 'hello' }))
    expect(read_profile(first.context)?.name).toBeUndefined()
    await write_profile(first.context, { bio: 'hello' })
    expect((await first.read_meta_log({ offset: 0, limit: 100, type: 'profile', current_only: false })).total).toBe(2)
    await expect(write_profile(first.context, { avatar: 'https://example.com/a.png' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(write_profile(first.context, { name: 'x'.repeat(129) })).rejects.toMatchObject({ code: 'invalid' })
  })

  test('§4.8.3 [MUST] an own library is created and retired for good, and a retired one refuses writes', async () => {
    const peer = await peers.start()
    const { entry } = await append_track({ peer, fingerprint: 'AQADretire' })
    const track_id = (entry.operation as { key: string }).key
    const mixes = await peer.create_own_library({ discriminator: 'mixes', about: { name: 'Mixes' } })
    expect(mixes).toMatchObject({ is_own: true, is_retired: false, library_type: 'recordstore', name: 'Mixes', replication_mode: 'full' })
    // Two active own recordstores: a track write must name its target, and a
    // label write with none goes to the labels library (§4.9).
    await expect(peer.remove_track({ track_id })).rejects.toMatchObject({ code: 'invalid' })
    const { own_address, labels_address } = peer.identity()
    expect(await peer.add_tag({ track_id, tag: 'x' })).toMatchObject({ tags: [{ library_address: labels_address, tag: 'x' }] })
    expect(await peer.add_tag({ track_id, tag: 'x', library_address: own_address })).toMatchObject({
      tags: [{ library_address: labels_address, tag: 'x' }, { library_address: own_address, tag: 'x' }].sort((a, b) => a.library_address < b.library_address ? -1 : 1)
    })

    await peer.retire_own_library(mixes.address)
    expect(await peer.get_library(mixes.address)).toMatchObject({ is_own: true, is_retired: true })
    await expect(peer.set_about({ address: mixes.address, fields: { name: 'again' } })).rejects.toMatchObject({ code: 'conflict' })
    await expect(peer.create_own_library({ discriminator: 'mixes' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(peer.add_tag({ track_id, tag: 'y', library_address: mixes.address })).rejects.toMatchObject({ code: 'conflict' })
    // One active recordstore again, so it is the default target.
    await peer.remove_track({ track_id })
    expect((await peer.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' })).total).toBe(0)
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

  test('§4.6.1 [MUST] an own library keeps its audio pinned across a restart, so removing a pin record never unpins it', async () => {
    const data_dir = mkdtempSync(join(tmpdir(), 'record-own-pins-'))
    const first = await peers.start({ config: { data_dir } })
    const { audio_cid } = await append_track({ peer: first, fingerprint: 'AQADownpin', audio: 'audio the own library holds' })
    await stop_peer(first)
    const restarted = await peers.start({ config: { data_dir } })
    expect(await restarted.content_store.is_pinned(audio_cid)).toBe(true)
    // The open's re-pin pass fills the pin set after the open returns.
    await restarted.context.libraries.pins_settled()
    const own = restarted.context.libraries.get(restarted.identity().own_address)
    expect(own?.pins.get(audio_cid)).toBe(true)
    await restarted.pin_track(audio_cid)
    await restarted.unpin_track(audio_cid)
    await wait_until(async () => (await records(restarted, 'pin')).every(({ op }) => op === 'DEL'))
    await restarted.context.libraries.settled()
    expect(await restarted.content_store.is_pinned(audio_cid)).toBe(true)
  })
})
