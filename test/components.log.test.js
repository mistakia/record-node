/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components', function () {
  this.timeout(config.timeout)
  let record

  before(async () => { record = await startRecord(config.node1) })
  after(async () => record && record.stop())

  describe('record.components.log', function () {
    it('mine', function () {
      const log = record.log.mine()
      assert.strictEqual(log.address.toString(), record.address)
    })

    it('isMine', async function () {
      const log = await record.log.get(record.address)
      const isMine = record.log.isMine(log)
      assert.strictEqual(isMine, true)
    })

    it('isOpen', function () {
      const isOpen = record.log.isOpen(record.address)
      assert.strictEqual(isOpen, true)
    })

    describe('get', function () {
      it('no address given', async function () {
        const log = await record.log.get()
        assert.strictEqual(log.address.toString(), record.address)
      })

      it('address given', async function () {
        const log = await record.log.get(record.address)
        assert.strictEqual(log.address.toString(), record.address)
      })
    })

    describe('errors', function () {
      it('throws an error if given invalid OrbitDB address', async function () {
        let error
        const address = 'invalid address'
        try {
          await record.log.get(address, { create: true })
        } catch (e) {
          error = e.toString()
        }

        assert.strictEqual(error, `Error: ${address} is not a valid log name`)
      })
    })
  })
})
