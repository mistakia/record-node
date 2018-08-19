const { sha256 } = require('crypto-hash')
const extend = require('deep-extend')
const { generateAvatar } = require('../utils')

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
    const track = extend({
      tags: []
    }, data)
    return super.create(id, this._type, track)
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

class FeedEntry {
  constructor (data, contact) {
    this._data = {
      entryId: data.payload.key,
      contactId: contact._id,
      type: data.payload.value.type,
      timestamp: Date.now()
    }
  }

  get () {
    return this._data
  }
}

class AboutEntry extends Entry {
  constructor (data) {
    super(data)

    this._type = 'about'
  }

  async create (data) {
    const id = await sha256(data.address)
    if (!data.avatar) {
      data.avatar = generateAvatar(id)
    }
    return super.create(id, this._type, data)
  }
}

module.exports = {
  Entry,
  AboutEntry,
  FeedEntry,
  TrackEntry,
  ContactEntry
}
