const crypto = require('crypto')

const Entry = require('./Entry')

class TrackEntry extends Entry {
  constructor (data) {
    super(data)

    this._type = 'track'
  }

  create (data) {
    const hash = crypto.createHash('sha256')
    const id = hash.update(data.url).digest('hex')
    return super.create(id, this._type, data)
  }
}

module.exports = TrackEntry
