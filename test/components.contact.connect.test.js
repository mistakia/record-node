/* global describe it beforeEach afterEach */

const assert = require('assert')
const { sha256 } = require('crypto-hash')
const {
  config,
  startRecord,
  waitForPeer
} = require('./utils')

describe('record.contact.connect', function () {
  this.timeout(config.timeout)
  let record1, record2

  beforeEach(async () => {
    record1 = await startRecord(config.node1)
    record2 = await startRecord(config.node2)

    await waitForPeer(record1, record2)
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
    await record1.contacts.add({ address: record2.address })
    await record1.contacts.connect(record2.address)
    const isReplicating = await record1.contacts.isReplicating(record2.address)
    assert.strictEqual(isReplicating, true)
  })

  it('connect + add + has + isReplicating', async function () {
    await record1.contacts.connect(record2.address)
    const contact = await record1.contacts.add({ address: record2.address })
    const has = await record1.contacts.has(record1.address, contact.id)
    const isReplicating = await record1.contacts.isReplicating(record2.address)
    assert.strictEqual(isReplicating, true)
    assert.strictEqual(has, true)
  })

  it('connect + add + remove + disconnect + has + isReplicating', async function () {
    await record1.contacts.connect(record2.address)
    const contact = await record1.contacts.add({ address: record2.address })
    await record1.contacts.remove(contact.id)
    await record1.contacts.disconnect(record2.address)
    const has = await record1.contacts.has(record1.address, contact.id)
    const isReplicating = await record1.contacts.isReplicating(record2.address)
    assert.strictEqual(isReplicating, false)
    assert.strictEqual(has, false)
    // TODO: check pubsub subscriptions
    // TODO: check log OrbitDB replicator
  })

  it('connect + disconnect + add + has + isReplicating', async function () {
    await record1.contacts.connect(record2.address)
    await record1.contacts.disconnect(record2.address)
    const contact = await record1.contacts.add({ address: record2.address })
    const has = await record1.contacts.has(record1.address, contact.id)
    const isReplicating = await record1.contacts.isReplicating(record2.address)
    assert.strictEqual(isReplicating, false)
    assert.strictEqual(has, true)
    // TODO: check pubsub subscriptions
    // TODO: check log OrbitDB replicator
  })

  it('disconnect + has + isReplicating', async function () {
    await record1.contacts.disconnect(record2.address)
    const contactId = await sha256(record2.address)
    const has = await record1.contacts.has(record1.address, contactId)
    const isReplicating = await record1.contacts.isReplicating(record2.address)
    assert.strictEqual(isReplicating, false)
    assert.strictEqual(has, false)
    // TODO: check pubsub subscriptions
    // TODO: check log OrbitDB replicator
  })

  describe('errors', function () {
    it('invalid address', async function () {

    })
  })
})
