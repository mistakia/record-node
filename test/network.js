/* global describe it before after */

const assert = require('assert')
const debug = require('debug')

debug.enable('libp2p:transports,libp2p:circuit*')

const {
  config,
  startRecord,
  connectNode
} = require('./utils')

describe('record', function () {
  this.timeout(config.timeout)
  const nodes = []

  before(async () => {
    const limit = 4
    for (let i = 0; i < limit; i++) {
      const { record } = await startRecord(i)
      nodes.push(record)

      const peer = nodes[i - 1]
      if (peer) {
        await connectNode(record, peer)
      }
    }
  })

  after(async () => {
    for (const node of nodes) {
      node && await node.stop()
    }
  })

  describe('record.network', () => {
    it('route ipfs content amoung connected peers', async () => {
      const about = await nodes[1].about.set({ name: 'Hello Network' })
      const dag = await nodes[0]._ipfs.dag.get(about.cid)

      assert.deepStrictEqual(about.content, dag.value)
    })

    it('route ipfs content amoung un-connected peers', async () => {
      const about = await nodes[1].about.get(nodes[1].address)
      const dag = await nodes[3]._ipfs.dag.get(about.cid)

      assert.deepStrictEqual(about.content, dag.value)
    })

    it('sync logs among connected peers', async () => {
      /* for (const node of nodes) {
       *   const peerLogs = await node.peers.list()
       *   const peerIds = peerLogs.map(p => p.peers).flat()
       *   const result = {
       *     address: node.address,
       *     peerId: node._orbitdb.id,
       *     peerIds
       *   }
       * }
       */
      const waitForSync = () => new Promise((resolve, reject) => {
        const events = []
        nodes[0].on('redux', (event) => {
          events.push(event)
          if (event.type === 'LOG_REPLICATED') {
            resolve(events)
          }
        })
        nodes[0].logs.link({ linkAddress: nodes[1].address }).then(() => nodes[0].logs.connect())
      })

      const events = await waitForSync()
      const logPeerJoined = events.filter(e => e.type === 'LOG_PEER_JOINED')
      const logReplicateProgress = events.filter(e => e.type === 'LOG_REPLICATE_PROGRESS')
      const logIndexUpdated = events.filter(e => e.type === 'LOG_INDEX_UPDATED')
      const logReplicated = events.filter(e => e.type === 'LOG_REPLICATED')

      assert.strictEqual(logPeerJoined[0].payload.address, nodes[1].address)
      assert.strictEqual(logReplicateProgress[0].payload.address, nodes[1].address)
      assert.notStrictEqual(logReplicateProgress[0].payload.hash, undefined)
      assert.strictEqual(logIndexUpdated[0].payload.address, nodes[0].address)
      assert.strictEqual(logReplicated[0].payload.address, nodes[1].address)
      assert.strictEqual(logReplicated[0].payload.length, 1)
    })

    it('sync logs among un-connected peers', async () => {

    })

    it('track', function () {

    })

    it('tag', function () {

    })

    it('complete - restart - load', function () {

    })

    it('interrupt/restart - resume', function () {

    })

    it('pause - resume', function () {

    })
  })
})
