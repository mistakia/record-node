const { sha256 } = require('crypto-hash')

class Entry {
  constructor (data) {
    this._data = data
  }

  create (id, type, data) {
    this._data = {
      _id: id,
      type,
      timestamp: Date.now(),
      content: data
    }

    return this._data
  }

  get () {
    return this._data
  }
}

class TrackEntry extends Entry {
  constructor (data) {
    super(data)

    this._type = 'track'
  }

  async create (data) {
    const id = await sha256(data.webpage_url)
    return super.create(id, this._type, data)
  }
}

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

module.exports = {
  Entry,
  TrackEntry,
  ContactEntry
}
