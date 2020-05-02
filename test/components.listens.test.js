/* global describe it beforeEach afterEach */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record', function () {
  this.timeout(config.timeout)
  let record

  beforeEach(async () => ({ record } = await startRecord('0')))
  afterEach(async () => record && record.stop())

  describe('components.listens', function () {
    const trackId = 'trackId'
    const cid = 'trackCID'
    it('add + get listen', async () => {
      await record.listens.add({ trackId, logAddress: record.address, cid })
      const listens = await record._listens.list()
      assert.strictEqual(listens.length, 1)
      assert.strictEqual(listens[0].trackId, trackId)
      assert.strictEqual(listens[0].logAddress, record.address)

      const count = record.listens.getCount(trackId)
      assert.strictEqual(count.trackId, trackId)
      assert.strictEqual(count.count, 1)
    })

    it('add multiple + get count', async () => {
      const limit = 4
      for (let i = 0; i < limit; i++) {
        await record.listens.add({ trackId, logAddress: record.address, cid })
      }

      const results = record.listens.getCount(trackId)
      assert.strictEqual(results.trackId, trackId)
      assert.strictEqual(results.count, limit)

      const trackId2 = 'trackId2'
      for (let i = 0; i < limit; i++) {
        await record.listens.add({ trackId: trackId2, logAddress: record.address, cid })
      }

      const result2 = record.listens.getCount(trackId2)
      assert.strictEqual(result2.trackId, trackId2)
      assert.strictEqual(result2.count, limit)

      const result3 = await record._listens.list()
      assert.strictEqual(result3.length, limit * 2)
      assert.strictEqual(result3[0].trackId, trackId2)
      assert.strictEqual(result3[result3.length - 1].trackId, trackId)
    })

    it('add 100 listens', async () => {
      const listenLimit = 100
      for (let i = 0; i < listenLimit; i++) {
        await record.listens.add({ trackId: `trackId${i}`, logAddress: record.address, cid })
      }

      const limit = 20
      let result = await record._listens.list({ limit })
      assert.strictEqual(result.length, 20)
      assert.strictEqual(result[0].trackId, `trackId${listenLimit - 1}`)

      result = await record._listens.list({ start: limit, limit })
      assert.strictEqual(result.length, 20)
      assert.strictEqual(result[0].trackId, `trackId${(listenLimit - limit) - 1}`)
    })

    // TODO - test list
    // TODO - test list with missing cids
  })
})
