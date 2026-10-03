// Capabilities between two identities (§3.5.5 to §3.5.10, chapter 7 write
// targets): the owner issues, the grantee writes into the owner's library
// under the capability, the owner's replica verifies and keeps the write, and
// a revocation stops the grantee.

import { afterEach, describe, expect, test } from 'bun:test'

import type { Peer } from '#peer/peer.ts'
import { stored_track } from '#test/helpers/library-manager.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

// Owner and grantee, the grantee replicating the owner's library.
const pair = async () => {
  const owner = await peers.start()
  const grantee = await peers.start()
  const address = owner.identity().own_address
  await grantee.link_library({ address, alias: 'shared' })
  return { owner, grantee, address }
}

const held_active = (peer: Peer, capability_id: string) => async () =>
  (await peer.list_held_capabilities()).some((capability) => capability.capability_id === capability_id && capability.status === 'active')

// A track content object the grantee has stored, ready to adopt by CID.
const content_on = async (peer: Peer, fingerprint: string) =>
  (await stored_track({ content_store: peer.content_store, fingerprint, audio: `audio of ${fingerprint}` })).content_cid

describe('capabilities', () => {
  test('§3.5.9 [MUST] a grantee writes into the owner\'s library under a capability, and the owner\'s replica keeps the write', async () => {
    const { owner, grantee, address } = await pair()
    const capability = await owner.issue_capability({
      library_address: address,
      grantee: { type: 'key', key: grantee.identity().key_pair.public_key },
      actions: ['library.append_track', 'library.append_tag']
    })
    expect(capability).toMatchObject({ status: 'active', issuer: owner.identity().key_pair.public_key, via_capability_id: null })
    await wait_until(held_active(grantee, capability.capability_id))
    expect((await grantee.get_library(address))?.held_capability_ids).toEqual([capability.capability_id])

    // Not an owner: without a capability_id the write is refused.
    const content_cid = await content_on(grantee, 'AQADshared')
    await expect(grantee.add_track({ content_cid, library_address: address })).rejects.toMatchObject({ code: 'forbidden' })
    const track = await grantee.add_track({ content_cid, library_address: address, capability_id: capability.capability_id })
    const tagged = await grantee.add_tag({ track_id: track.id, tag: 'from-friend', library_address: address, capability_id: capability.capability_id })
    expect(tagged.tags).toContainEqual({ library_address: address, tag: 'from-friend' })

    // A DEL needs an owner: no action authorises one (§3.5.6).
    await expect(grantee.remove_track({ track_id: track.id, library_address: address })).rejects.toMatchObject({ code: 'forbidden' })

    await wait_until(async () => (await owner.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' }))
      .items.some(({ id, tags }) => id === track.id && tags.some(({ tag }) => tag === 'from-friend')))
  })

  test('§3.5.7 [MUST] a capability\'s filter scopes the writes it authorises', async () => {
    const { owner, grantee, address } = await pair()
    const capability = await owner.issue_capability({
      library_address: address,
      grantee: { type: 'key', key: grantee.identity().key_pair.public_key },
      actions: ['library.append_tag'],
      filter: { type: 'match', fields: { tags: 'friends-mix' } }
    })
    const { entry } = await append_track({ peer: owner, fingerprint: 'AQADfiltered' })
    const track_id = (entry.operation as { key: string }).key
    await wait_until(held_active(grantee, capability.capability_id))
    // A client tags a track it lists, so its content payload is local.
    await wait_until(async () => (await grantee.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc', library_addresses: [address] }))
      .items.some(({ id }) => id === track_id))
    const target = { library_address: address, capability_id: capability.capability_id }
    await expect(grantee.add_tag({ track_id, tag: 'other', ...target })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await grantee.add_tag({ track_id, tag: 'friends-mix', ...target })).tags).toContainEqual({ library_address: address, tag: 'friends-mix' })
  })

  test('§3.5.10 [MUST] once a grantee has merged a revocation, its writes under the capability are refused', async () => {
    const { owner, grantee, address } = await pair()
    const capability = await owner.issue_capability({
      library_address: address,
      grantee: { type: 'key', key: grantee.identity().key_pair.public_key },
      actions: ['library.append_track']
    })
    await wait_until(held_active(grantee, capability.capability_id))
    await owner.revoke_capability({ library_address: address, capability_id: capability.capability_id })
    expect((await owner.list_capabilities(address)).find(({ capability_id }) => capability_id === capability.capability_id))
      .toMatchObject({ status: 'revoked' })
    await wait_until(async () => (await grantee.list_held_capabilities()).some(({ capability_id, status }) => capability_id === capability.capability_id && status === 'revoked'))
    const content_cid = await content_on(grantee, 'AQADrevoked')
    await expect(grantee.add_track({ content_cid, library_address: address, capability_id: capability.capability_id }))
      .rejects.toMatchObject({ code: 'capability_revoked' })
  })

  test('§3.5.10 [MUST] the owner revokes a capability its node has not merged', async () => {
    const owner = await peers.start()
    const other = await peers.start()
    const address = owner.identity().own_address
    // A capability id the owner's library has never seen, as a delegated
    // grant still in flight would be.
    const unseen = await other.issue_capability({
      library_address: other.identity().own_address,
      grantee: { type: 'key', key: owner.identity().key_pair.public_key },
      actions: ['library.append_track']
    })
    const revocations = () => [...(owner.context.libraries.get(address)?.oplog.revocations.values() ?? [])]
      .filter((entry) => (entry.operation as unknown as { value: { revokes: string } }).value.revokes === unseen.capability_id)
    await owner.revoke_capability({ library_address: address, capability_id: unseen.capability_id })
    expect(revocations()).toHaveLength(1)
    // Revoking it again appends nothing, and a malformed id names no capability.
    await owner.revoke_capability({ library_address: address, capability_id: unseen.capability_id })
    expect(revocations()).toHaveLength(1)
    await expect(owner.revoke_capability({ library_address: address, capability_id: 'not-a-cid' })).rejects.toMatchObject({ code: 'not_found' })
  })

  test('§3.5.8 [MUST] a write timestamped after expires_at is refused as expired', async () => {
    const { owner, grantee, address } = await pair()
    const capability = await owner.issue_capability({
      library_address: address,
      grantee: { type: 'key', key: grantee.identity().key_pair.public_key },
      actions: ['library.append_track'],
      conditions: [{ type: 'expires_at', at: Date.now() - 1 }]
    })
    expect(capability.status).toBe('expired')
    await wait_until(() => grantee.context.libraries.get(address)?.oplog.capabilities.has(capability.capability_id) === true)
    const content_cid = await content_on(grantee, 'AQADexpired')
    await expect(grantee.add_track({ content_cid, library_address: address, capability_id: capability.capability_id }))
      .rejects.toMatchObject({ code: 'capability_expired' })
  })

  test('§3.5.5 [MUST] the node refuses to issue a capability it could not verify writes under', async () => {
    const { owner, grantee, address } = await pair()
    const grantee_spec = { type: 'key', key: grantee.identity().key_pair.public_key }
    await expect(owner.issue_capability({ library_address: address, grantee: grantee_spec, actions: ['library.append_listen'] }))
      .rejects.toMatchObject({ code: 'invalid_shape' })
    await expect(owner.issue_capability({ library_address: address, grantee: grantee_spec, actions: ['library.append_track'], filter: { type: 'regex', field: 'tags' } }))
      .rejects.toMatchObject({ code: 'invalid_shape' })
    await expect(owner.issue_capability({ library_address: owner.identity().listens_address, grantee: grantee_spec, actions: ['library.append_track'] }))
      .rejects.toMatchObject({ code: 'invalid' })
  })
})
