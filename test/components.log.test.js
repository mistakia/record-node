/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord,
  connectNode
} = require('./utils')

describe('record.components', function () {
  this.timeout(config.timeout)
  let record1, record2

  before(async () => {
    // eslint-disable-next-line
    ({ record: record1 } = await startRecord('0'));
    // eslint-disable-next-line
    ({ record: record2 } = await startRecord('1'));
    await connectNode(record1, record2)
  })
  after(async () => {
    try {
      record1 && await record1.stop()
      record2 && await record2.stop()
    } catch (e) {
      console.log(e)
    }
  })

  describe('record.components.log', function () {
    it('mine', function () {
      const log = record1.log.mine()
      assert.strictEqual(log.address.toString(), record1.address)
    })

    it('isMine', async function () {
      const log = await record1.log.get(record1.address)
      const isMine = record1.log.isMine(log)
      assert.strictEqual(isMine, true)
    })

    it('isOpen', function () {
      const isOpen = record1.log.isOpen(record1.address)
      assert.strictEqual(isOpen, true)
    })

    it('canAppend', async function () {
      const canAppend1 = await record1.log.canAppend(record1.address)
      assert.strictEqual(canAppend1, true)
      const canAppend2 = await record1.log.canAppend(record2.address)
      assert.strictEqual(canAppend2, false)
    })

    describe('get', function () {
      it('no address given', async function () {
        const log = await record1.log.get()
        assert.strictEqual(log.address.toString(), record1.address)
      })

      it('address given', async function () {
        const log = await record1.log.get(record1.address)
        assert.strictEqual(log.address.toString(), record1.address)
      })
    })

    describe('errors', function () {
      it('throws an error if given invalid OrbitDB address', async function () {
        let error
        const address = 'invalid address'
        try {
          await record1.log.get(address, { create: true })
        } catch (e) {
          error = e.toString()
        }

        assert.strictEqual(error, `Error: ${address} is not a valid log name`)
      })
    })
  })
})
