class RecordFeedIndex {
  constructor (oplog) {
    this._oplog = oplog
    this._index = []
  }

  getEntryIndex (hash) {
    return Array.from(this._oplog._hashIndex.keys()).indexOf(hash)
  }

  async loadIndex () {
    // TODO
  }

  async updateIndex () {
    // do nothing
  }
}

module.exports = RecordFeedIndex
