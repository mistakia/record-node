const RecordStore = require('./RecordStore')
const RecordFeedIndex = require('./RecordFeedIndex')

class RecordFeedStore extends RecordStore {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.Index) Object.assign(options, { Index: RecordFeedIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordFeedStore.type
  }

  async query (opts = {}) {
    const limit = opts.limit || 20
    const startHash = opts.start || null
    const startIndex = startHash ? this._index.getEntryIndex(startHash) : 0

    const entryHashes = this._index._index.slice(startIndex, limit)
    let entries = []
    for (const entryHash of entryHashes) {
      const entry = await this._oplog.get(entryHash)
      entries.push(entry)
    }
    return entries
  }

  add (data) {
    return this._addOperation(data)
  }

  static get type () {
    return 'recordfeedstore'
  }
}

module.exports = RecordFeedStore
