/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record', function () {
  this.timeout(config.timeout)
  let record

  before(async () => { record = await startRecord(config.node1) })
  after(async () => record && record.stop())

  describe('constructor', function () {
    it('returns an instance', function () {
      // components
      assert.strictEqual(typeof record.about, 'object')
      assert.strictEqual(typeof record.bootstrap, 'object')
      assert.strictEqual(typeof record.contacts, 'object')
      assert.strictEqual(typeof record.info, 'object')
      assert.strictEqual(typeof record.listens, 'object')
      assert.strictEqual(typeof record.log, 'object')
      assert.strictEqual(typeof record.tags, 'object')
      assert.strictEqual(typeof record.tracks, 'object')
      assert.strictEqual(typeof record.peers, 'object')

      assert.strictEqual(typeof record.init, 'function')
      assert.strictEqual(typeof record.stop, 'function')
      assert.strictEqual(typeof record.start, 'function')
      assert.strictEqual(typeof record.gc, 'function')
      assert.strictEqual(typeof record.getKeys, 'function')
      assert.strictEqual(typeof record.createIdentity, 'function')
      assert.strictEqual(typeof record.setIdentity, 'function')
      assert.strictEqual(typeof record.checkContentPin, 'function')

      assert.strictEqual(typeof record.address, 'string')
      assert.strictEqual(typeof record.isMe, 'function')

      // utils
      assert.strictEqual(typeof record.isValidAddress, 'function')
      assert.strictEqual(typeof record.parseAddress, 'function')
      assert.strictEqual(typeof record.resolve, 'function')
    })

    it('address', async function () {
      const log = await record.log.get()
      assert.strictEqual(record.address, log.address.toString())
    })

    it('isMe', async function () {
      const log = await record.log.get()
      const isMe = await record.isMe(log.address.toString())
      assert.strictEqual(isMe, true)
    })
  })

  it('load existing account', function () {

  })

  it('generate new account', function () {

  })
})
