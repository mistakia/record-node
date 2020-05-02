/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.restart', function () {
  this.timeout(config.timeout)
  let record, ipfsd

  before(async () => {
    ({ record, ipfsd } = await startRecord('0', { restartable: true }))
  })

  after(async () => record && record.stop())

  describe('restart', function () {
    const about = {
      name: 'Test Node',
      bio: 'a test node',
      location: 'test world'
    }

    it('reload about', async function () {
      const aboutEntry = await record.about.set(about)
      assert.ok(aboutEntry.contentCID)

      await record.stop()
      await ipfsd.stop()

      await ipfsd.start()
      await record.start()

      const entry = await record.about.get(record.address)
      assert.strictEqual(aboutEntry, entry)
    })
  })
})
