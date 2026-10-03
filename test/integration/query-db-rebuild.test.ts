// §4.7 after replication: rebuilding the query database from the replicated
// oplogs yields the rows incremental projection wrote as entries arrived.

import { afterEach, describe, expect, test } from 'bun:test'

import { rebuild_query_db } from '#query-db/rebuild.ts'
import { open_query_db } from '#query-db/schema.ts'
import { dump_query_db } from '#test/query-db/fixtures.ts'
import { append_track, create_memory_peers, wait_until } from '#test/helpers/network.ts'

const peers = create_memory_peers()
afterEach(async () => { await peers.stop_all() })

describe('query database rebuild', () => {
  test('a rebuild from the replicated oplogs equals incremental projection', async () => {
    const a = await peers.start()
    const b = await peers.start()
    const address = a.identity().own_address
    await a.set_about({ address, fields: { name: 'A', bio: 'replicated' } })
    const tracks = []
    for (const fingerprint of ['AQADone', 'AQADtwo', 'AQADthree']) tracks.push(await append_track({ peer: a, fingerprint }))
    const [first, second] = tracks.map(({ entry }) => (entry.operation as { key: string }).key) as [string, string]
    await a.add_tag({ track_id: first, tag: 'kept' })
    await a.remove_track({ track_id: second })

    await b.link_library({ address, alias: 'a' })
    const source = a.context.libraries.get(address)?.oplog
    const replica = () => b.context.libraries.get(address)?.oplog
    await wait_until(() => replica()?.entries.size === source?.entries.size)
    await b.context.replication?.settled(address)
    await b.context.libraries.settled()
    expect((await b.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'title', order: 'asc', library_addresses: [address] })).total).toBe(2)

    const rebuilt = open_query_db()
    const { rejected } = await rebuild_query_db({
      db: rebuilt,
      libraries: b.context.libraries.list().map(({ chain, oplog }) => ({ chain, blocks: [...oplog.entries.values()].map(({ bytes }) => bytes) })),
      read_content: b.content_store.get
    })
    expect(rejected).toEqual([])
    expect(dump_query_db(rebuilt)).toEqual(dump_query_db(b.db))
  })
})
