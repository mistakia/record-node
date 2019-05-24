const RecordStore = require('./RecordStore')
const RecordFeedIndex = require('./RecordFeedIndex')

class RecordListensStore extends RecordStore {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.Index) Object.assign(options, { Index: RecordFeedIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordListensStore.type
  }

  async query (opts = {}) {
    const startHash = opts.start || null
    const start = startHash ? this._index.getEntryIndex(startHash) : 0
    const end = opts.end || start + 20

    const entryHashes = this._index._index.slice(start, end)
    let entries = []
    for (const entryHash of entryHashes) {
      const entry = await this._oplog.get(entryHash)
      entries.push(entry)
    }
    return entries
  }

  add ({ trackId, logId }) {
    return this._addOperation({
      trackId,
      logId,
      timestamp: new Date()
    })
  }

  static get type () {
    return 'recordlistensstore'
  }
}

module.exports = RecordListensStore
