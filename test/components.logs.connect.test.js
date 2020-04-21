/* global describe it beforeEach afterEach */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components.logs.connect', function () {
  this.timeout(config.timeout)
  let record1, record2

  beforeEach(async () => {
    record2 = await startRecord(config.node2)
    record1 = await startRecord(config.node1, record2)
  })

  afterEach(async () => {
    try {
      record1 && await record1.stop()
      record2 && await record2.stop()
    } catch (e) {
      console.log(e)
    }
  })

  it('connect + isReplicating', async function () {
    await record1.logs.add({ linkAddress: record2.address })
    await record1.logs.connect(record2.address)
    const isReplicating = await record1.logs.isReplicating(record2.address)
    assert.strictEqual(isReplicating, true)
  })

  it('connect + add + has + isReplicating', async function () {
    await record1.logs.connect(record2.address)
    const linkedLog = await record1.logs.add({ linkAddress: record2.address })
    const has = await record1.logs.has(record1.address, linkedLog.content.address)
    const isReplicating = await record1.logs.isReplicating(record2.address)
    assert.strictEqual(isReplicating, true)
    assert.strictEqual(has, true)
  })

  it('connect + add + remove + disconnect + has + isReplicating', async function () {
    await record1.logs.connect(record2.address)
    const linkedLog = await record1.logs.add({ linkAddress: record2.address })
    await record1.logs.remove(linkedLog.content.address)
    await record1.logs.disconnect(record2.address)
    const has = await record1.logs.has(record1.address, linkedLog.content.address)
    const isReplicating = await record1.logs.isReplicating(record2.address)
    assert.strictEqual(isReplicating, false)
    assert.strictEqual(has, false)
    // TODO: check pubsub subscriptions
    // TODO: check log OrbitDB replicator
  })

  it('connect + disconnect + add + has + isReplicating', async function () {
    await record1.logs.connect(record2.address)
    await record1.logs.disconnect(record2.address)
    const linkedLog = await record1.logs.add({ linkAddress: record2.address })
    const has = await record1.logs.has(record1.address, linkedLog.content.address)
    const isReplicating = await record1.logs.isReplicating(record2.address)
    assert.strictEqual(isReplicating, false)
    assert.strictEqual(has, true)
    // TODO: check pubsub subscriptions
    // TODO: check log OrbitDB replicator
  })

  it('disconnect + has + isReplicating', async function () {
    await record1.logs.disconnect(record2.address)
    const has = await record1.logs.has(record1.address, record2.address)
    const isReplicating = await record1.logs.isReplicating(record2.address)
    assert.strictEqual(isReplicating, false)
    assert.strictEqual(has, false)
    // TODO: check pubsub subscriptions
    // TODO: check log OrbitDB replicator
  })

  // TODO
  /* describe('errors', function () {
   *   it('invalid address', async function () {

   *   })
   * }) */
})
