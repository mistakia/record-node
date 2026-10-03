// Runs inside the scratch project of git-dependency.sh, under plain Node,
// against record-node as installed in its node_modules: one peer ingests the
// F7 file, and a second replicates it over the §5.5.1 libp2p profile, both on
// loopback.

import { strict as assert } from 'node:assert'

import { create_peer, start_peer, stop_peer } from 'record-node'

const F7_TRACK_ID = '20599ccf9f5efb8cc1d6e2ae464471f6f8fab82066a42579b07024d7673b1005'
const QUERY = { offset: 0, limit: 10, shuffle: false, sort: 'added_at', order: 'desc' }
const NETWORK = { listen: ['/ip4/127.0.0.1/tcp/0'], bootstrap: [], mdns: false, dht: false }
const [fixture_path] = process.argv.slice(2)
const allow_toolchain_mismatch = process.env.RECORD_TOOLCHAIN_PREFLIGHT === 'bypass'

const start = async (network) => {
  const peer = await create_peer({ config: { allow_toolchain_mismatch, network } })
  await start_peer(peer)
  return peer
}

const wait_for_track = (peer, library_address) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { reject(new Error('the track did not replicate within 20 s')) }, 20_000)
  const unsubscribe = peer.subscribe(({ type, payload }) => {
    if (type !== 'track:added' || payload.library_address !== library_address) return
    clearTimeout(timer)
    unsubscribe()
    resolve(payload.track)
  })
})

const a = await start(NETWORK)
const { peer_id, addresses } = await a.get_settings()
const b = await start({ ...NETWORK, bootstrap: [`${addresses[0]}/p2p/${peer_id}`] })
try {
  const track = await a.ingest_file(fixture_path)
  assert.equal(track.track_id, F7_TRACK_ID)
  const { items, total } = await a.list_tracks(QUERY)
  assert.equal(total, 1)
  assert.equal(items[0].id, F7_TRACK_ID)

  const library_address = a.identity().own_address
  const replicated = wait_for_track(b, library_address)
  await b.link_library({ address: library_address, alias: null })
  assert.equal((await replicated).id, F7_TRACK_ID)
  console.log(`node ${process.version}: git-dependency smoke passed (${library_address} replicated)`)
} finally {
  await stop_peer(b)
  await stop_peer(a)
}
