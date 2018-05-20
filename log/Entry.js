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

module.exports = Entry
