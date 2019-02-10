const RecordStore = require('./RecordStore')
const RecordFeedIndex = require('./RecordFeedIndex')

class RecordListensStore extends RecordStore {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.Index) Object.assign(options, { Index: RecordFeedIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordListensStore.type
  }

  async query (opts = {}) {
    const limit = opts.limit || 20
    const startCID = opts.start || null
    const startIndex = startCID ? this._index.getEntryIndex(startCID) : 0

    const entryCIDs = this._index._index.slice(startIndex, limit)
    let entries = []
    for (const entryCID of entryCIDs) {
      const entry = await this._oplog.get(entryCID)
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
