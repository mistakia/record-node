/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record', function () {
  this.timeout(config.timeout)
  let record

  // TODO: use test fixtures for identities
  before(async () => { record = await startRecord() })
  after(async () => record && record.stop())

  describe('constructor', function () {
    it('returns an instance', function () {
      // utils
      assert.notStrictEqual(record.isValidAddress, undefined)
      assert.notStrictEqual(record.parseAddress, undefined)

      // components
      assert.notStrictEqual(record.about, undefined)
      assert.notStrictEqual(record.bootstrap, undefined)
      assert.notStrictEqual(record.contacts, undefined)
      assert.notStrictEqual(record.info, undefined)
      assert.notStrictEqual(record.listens, undefined)
      assert.notStrictEqual(record.log, undefined)
      assert.notStrictEqual(record.tags, undefined)
      assert.notStrictEqual(record.tracks, undefined)
      assert.notStrictEqual(record.peers, undefined)

      // address

      // isMe
    })
  })
})
