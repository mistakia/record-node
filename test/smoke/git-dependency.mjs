// Runs inside the scratch project of git-dependency.sh, under plain Node,
// against record-node as installed in its node_modules.

import { strict as assert } from 'node:assert'

import { create_peer, start_peer, stop_peer } from 'record-node'

const F7_TRACK_ID = '20599ccf9f5efb8cc1d6e2ae464471f6f8fab82066a42579b07024d7673b1005'
const [fixture_path] = process.argv.slice(2)

const peer = await create_peer({ config: { allow_toolchain_mismatch: process.env.RECORD_TOOLCHAIN_PREFLIGHT === 'bypass' } })
await start_peer(peer)
try {
  const track = await peer.ingest_file(fixture_path)
  assert.equal(track.track_id, F7_TRACK_ID)
  const { items, total } = await peer.list_tracks({ offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' })
  assert.equal(total, 1)
  assert.equal(items[0].id, F7_TRACK_ID)
  console.log(`node ${process.version}: git-dependency smoke passed (${peer.identity().own_address})`)
} finally {
  await stop_peer(peer)
}
