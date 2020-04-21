/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components.logs', function () {
  this.timeout(config.timeout)
  let record1, record2, link

  before(async () => {
    record2 = await startRecord(config.node2)
    record1 = await startRecord(config.node1, record2)

    link = {
      linkAddress: record2.address,
      alias: 'test node2'
    }
  })

  after(async () => {
    try {
      record1 && await record1.stop()
      record2 && await record2.stop()
    } catch (e) {
      console.log(e)
    }
  })

  describe('record.logs.add', function () {
    it('add + list', async function () {
      const linkedLog = await record1.logs.add(link)
      assert.strictEqual(linkedLog.content.address, record2.address)
      const linkedLogs = await record1.logs.list()
      assert.strictEqual(linkedLogs[0].content.address, record2.address)
      assert.strictEqual(linkedLogs.length, 1)
    })

    it('duplicate + list', async function () {
      await record1.logs.add(link)
      const linkedLogs = await record1.logs.list()
      assert.strictEqual(linkedLogs.length, 1)
      assert.strictEqual(record1._log._oplog.length, 1)
    })

    it('remove + list', async function () {
      await record1.logs.remove(link.linkAddress)
      const linkedLogs = await record1.logs.list()
      assert.strictEqual(linkedLogs.length, 0)
      assert.strictEqual(record1._log._oplog.length, 2)
    })

    it('re-add + list', async function () {
      await record1.logs.add(link)
      const linkedLogs = await record1.logs.list()
      assert.strictEqual(linkedLogs.length, 1)
      assert.strictEqual(record1._log._oplog.length, 3)
    })

    it('duplicate + rename + list', function () {

    })

    describe('errors', function () {
      it('add yourself', async function () {
        let error
        try {
          await record1.logs.add({ linkAddress: record1.address })
        } catch (e) {
          error = e
        }
        assert.ok(error)
      })

      it('invalid address', async function () {
        let error
        try {
          await record1.logs.add({ linkAddress: 'invalid address' })
        } catch (e) {
          error = e
        }
        assert.ok(error)
      })
    })
  })
})
