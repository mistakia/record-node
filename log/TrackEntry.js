const { sha256 } = require('crypto-hash')

const Entry = require('./Entry')

class TrackEntry extends Entry {
  constructor (data) {
    super(data)

    this._type = 'track'
  }

  async create (data) {
    const id = await sha256(data.url)
    return super.create(id, this._type, data)
  }
}

module.exports = TrackEntry
