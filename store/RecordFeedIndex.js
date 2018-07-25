class RecordFeedIndex {
  constructor (id) {
    this._index = []
  }

  getEntryIndex (hash) {
    return this._index.indexOf(hash)
  }

  async updateIndex (oplog) {
    this._index = Array.from(oplog._nextsIndex.keys())
  }
}

module.exports = RecordFeedIndex
