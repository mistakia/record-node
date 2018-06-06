const { sha256 } = require('crypto-hash')

const Entry = require('./Entry')

class ContactEntry extends Entry {
  constructor (data) {
    super(data)

    this._type = 'contact'
  }

  async create (data) {
    const id = await sha256(data.address)
    return super.create(id, this._type, data)
  }
}

module.exports = ContactEntry
