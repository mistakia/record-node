// Node smoke run of the query database: `node test/query-db/node-smoke.ts`.
// record-app runs the node as a Node child process (spec §8.3.1), so node:sqlite, the
// projector, and rebuild must run there as well as under Bun. Exits nonzero
// when incremental and rebuilt rows differ.

import { deepStrictEqual, ok } from 'node:assert/strict'

import { generate_key_pair } from '#identity/key-pair.ts'
import { create_oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { create_projector } from '#query-db/projector.ts'
import { list_tracks } from '#query-db/queries.ts'
import { rebuild_query_db } from '#query-db/rebuild.ts'
import { open_query_db } from '#query-db/schema.ts'
import { blocks_of, open_test_library } from '#test/helpers/library.ts'
import { add_track, delete_track, dump_query_db, in_batches, jittered_reader } from './fixtures.ts'

const [alice, bob] = [generate_key_pair(), generate_key_pair()]
const { chain, block_store } = await open_test_library({ writers: [alice, bob] })
const alice_log = create_oplog({ chain })
const bob_log = create_oplog({ chain })
for (const fingerprint of ['AQAA-1', 'AQAA-2', 'AQAA-3']) {
  await add_track({ oplog: alice_log, key_pair: alice, block_store, fingerprint, title: `alice ${fingerprint}`, tags: ['a'] })
  await add_track({ oplog: bob_log, key_pair: bob, block_store, fingerprint, title: `bob ${fingerprint}`, tags: ['b'] })
}
delete_track({ oplog: alice_log, key_pair: alice, key: [...alice_log.current.keys()][0] as string })
const blocks = [...blocks_of(alice_log), ...blocks_of(bob_log)]

const oplog = create_oplog({ chain })
const db = open_query_db()
const projector = create_projector({ db, read_content: jittered_reader(block_store) })
await Promise.all(in_batches(blocks, 2).map((batch) => projector.project_merge({ oplog, result: merge_entries({ oplog, blocks: batch }) })))

const rebuilt = open_query_db()
await rebuild_query_db({ db: rebuilt, read_content: block_store.get, libraries: [{ chain, blocks }] })
deepStrictEqual(dump_query_db(db), dump_query_db(rebuilt))
const { total } = list_tracks({ db: rebuilt })
ok(total === 2, `expected 2 live tracks, got ${total}`)
console.log(`query-db node smoke ok: ${process.version}, ${blocks.length} entries, ${total} live tracks, rebuild equals incremental`)
