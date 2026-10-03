// Two peers converge over the real §5.5.1 profile: gossipsub heads exchange
// and bitswap fetch across a PSK-protected TCP connection on loopback.

import { afterEach, describe, expect, test } from 'bun:test'

import { compute_track_id } from '#entry/id.ts'
import { create_libp2p_peers, dial_address } from '#test/helpers/libp2p.ts'
import { append_track, wait_for_event } from '#test/helpers/network.ts'

const peers = create_libp2p_peers()
afterEach(async () => { await peers.stop_all() })

const QUERY = { offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' } as const

describe('libp2p replication', () => {
  test('two peers converge on each other\'s libraries in both directions', async () => {
    const a = await peers.start()
    const b = await peers.start({ bootstrap: [await dial_address(a)] })
    await append_track({ peer: a, fingerprint: 'AQADtEmSaImS' })
    await append_track({ peer: b, fingerprint: 'AQADtEmSaImT' })
    const a_address = a.identity().own_address
    const b_address = b.identity().own_address

    const b_has_a = wait_for_event(b, (event) => event.type === 'track:added' && event.payload.library_address === a_address)
    const a_has_b = wait_for_event(a, (event) => event.type === 'track:added' && event.payload.library_address === b_address)
    await b.link_library({ address: a_address, alias: null })
    await a.link_library({ address: b_address, alias: null })
    await Promise.all([b_has_a, a_has_b])

    const ids = async (peer: typeof a, address: string) =>
      (await peer.list_tracks({ ...QUERY, library_addresses: [address] })).items.map(({ id }) => id)
    expect(await ids(b, a_address)).toEqual([compute_track_id('AQADtEmSaImS')])
    expect(await ids(a, b_address)).toEqual([compute_track_id('AQADtEmSaImT')])
    const heads = (peer: typeof a, address: string) => [...(peer.context.libraries.get(address)?.oplog.heads ?? [])].sort()
    expect(heads(b, a_address)).toEqual(heads(a, a_address))
    expect(heads(a, b_address)).toEqual(heads(b, b_address))
  })
})
