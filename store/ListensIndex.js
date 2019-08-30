class ListensIndex {
  constructor (oplog) {
    this._oplog = oplog
    this._index = []
  }

  getEntryIndex (hash) {
    return this._index.indexOf(hash)
  }

  async loadIndex (oplog) {
    this._oplog = oplog
    this._index = Array.from(oplog._hashIndex.keys())
  }

  async updateIndex () {
    this._index = Array.from(this._oplog._hashIndex.keys())
  }
}

module.exports = ListensIndex
