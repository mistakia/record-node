/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.log', function () {
  this.timeout(config.timeout)
  let record

  before(async () => { record = await startRecord() })
  after(async () => record && record.stop())

  describe('record.log.get', function () {
    describe('errors', function () {
      it('throws an error if given invalid OrbitDB address', async function () {
        let error
        const address = 'invalid-db-address'
        try {
          await record.log.get(address)
        } catch (e) {
          error = e.toString()
        }

        assert.equal(error, `Error: ${address} is not a valid OrbitDB address`)
      })
    })

    // mine

    // isMine

    // isOpen

    // get
  })
})
