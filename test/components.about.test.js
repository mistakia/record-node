/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components', function () {
  this.timeout(config.timeout)
  let record

  before(async () => { record = await startRecord('0') })
  after(async () => record && record.stop())

  describe('record.components.about', function () {
    let aboutEntry
    const about = {
      name: 'Test Node',
      bio: 'a test node',
      location: 'test world'
    }

    describe('add', function () {
      it('contentCID', async function () {
        aboutEntry = await record.about.set(about)
        assert.ok(aboutEntry.contentCID)
      })
    })

    describe('get', async function () {
      it('contentCID', async function () {
        const entry = await record.about.get(record.address)
        assert.strictEqual(entry.contentCID, aboutEntry.contentCID)
      })
    })

    describe('add duplicate', async function () {
      let duplicateEntry
      before(async () => { duplicateEntry = await record.about.set(about) })

      it('contentCID', function () {
        assert.strictEqual(duplicateEntry.contentCID, aboutEntry.contentCID)
      })

      it('duplicate detected', function () {
        const log = record.log.mine()
        assert.strictEqual(log._oplog.length, 1)
      })
    })
  })
})
