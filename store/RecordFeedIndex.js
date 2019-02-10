class RecordFeedIndex {
  constructor (id) {
    this._index = []
  }

  getEntryIndex (cid) {
    return this._index.indexOf(cid)
  }

  async updateIndex (oplog) {
    this._index = Array.from(oplog._cidIndex.keys())
  }
}

module.exports = RecordFeedIndex
