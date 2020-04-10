/* global describe it before after */

const assert = require('assert')
const {
  config,
  startRecord
} = require('./utils')

describe('record.components.contact', function () {
  this.timeout(config.timeout)
  let record1, record2, contact2, contact2Id

  before(async () => {
    record2 = await startRecord(config.node2)
    record1 = await startRecord(config.node1, record2)

    contact2 = {
      address: record2.address,
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

  describe('record.contact.add', function () {
    it('add + list', async function () {
      const contact = await record1.contacts.add(contact2)
      contact2Id = contact.id
      assert.strictEqual(contact.content.address, record2.address)
      const contacts = await record1.contacts.list()
      assert.strictEqual(contacts[0].content.address, record2.address)
      assert.strictEqual(contacts.length, 1)
    })

    it('duplicate + list', async function () {
      await record1.contacts.add(contact2)
      const contacts = await record1.contacts.list()
      assert.strictEqual(contacts.length, 1)
      assert.strictEqual(record1._log._oplog.length, 1)
    })

    it('remove + list', async function () {
      await record1.contacts.remove(contact2Id)
      const contacts = await record1.contacts.list()
      assert.strictEqual(contacts.length, 0)
      assert.strictEqual(record1._log._oplog.length, 2)
    })

    it('re-add + list', async function () {
      await record1.contacts.add(contact2)
      const contacts = await record1.contacts.list()
      assert.strictEqual(contacts.length, 1)
      assert.strictEqual(record1._log._oplog.length, 3)
    })

    it('duplicate + rename + list', function () {

    })

    describe('errors', function () {
      it('add yourself', async function () {
        let error
        try {
          await record1.contacts.add({ address: record1.address })
        } catch (e) {
          error = e
        }
        assert.ok(error)
      })

      it('invalid address', async function () {
        let error
        try {
          await record1.contacts.add({ address: 'invalid address' })
        } catch (e) {
          error = e
        }
        assert.ok(error)
      })
    })
  })
})
