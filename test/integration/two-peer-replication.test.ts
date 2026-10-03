// Two peers on the in-memory network: B links A's library, loads its AC chain
// from A, replicates its entries, and indexes the track once its content lands.

import { afterEach, describe, expect, test } from 'bun:test'

import { compute_track_id } from '#entry/id.ts'
import { verify_entry_authorisation } from '#access-control/verify.ts'
import type { Track } from '#types/peer.ts'
import { append_track, create_memory_peers, wait_for_event } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

const QUERY = { offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' } as const

describe('two-peer replication', () => {
  test('B replicates A\'s track entry with a valid signature and indexes it', async () => {
    const a = await peers.start()
    const b = await peers.start()
    const { entry } = await append_track({ peer: a, fingerprint: 'AQADtEmSaImS' })
    const a_address = a.identity().own_address

    const added = wait_for_event(b, (event) => event.type === 'track:added' && event.payload.library_address === a_address)
    await b.link_library({ address: a_address, alias: null })
    const { payload } = await added as { payload: { track: Track } }
    expect(payload.track.id).toBe(compute_track_id('AQADtEmSaImS'))

    const replicated = b.context.libraries.get(a_address)?.oplog.entries.get(entry.hash)
    expect(replicated?.bytes).toEqual(entry.bytes)
    const chain = b.context.libraries.get(a_address)?.oplog.chain
    expect(verify_entry_authorisation({ entry: replicated?.entry as never, write_list: chain?.write_list ?? [] }).ok).toBe(true)

    const { items } = await b.list_tracks({ ...QUERY, library_addresses: [a_address] })
    expect(items.map(({ id }) => id)).toEqual([compute_track_id('AQADtEmSaImS')])
  })
})
