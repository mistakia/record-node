const RecordStore = require('./RecordStore')
const RecordFeedIndex = require('./RecordFeedIndex')

const { FeedEntry } = require('./RecordEntry')

class RecordFeedStore extends RecordStore {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.Index) Object.assign(options, { Index: RecordFeedIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordFeedStore.type
  }

  async query (opts = {}) {
    const getStartIndex = (start, hash) => {
      if (start) { return start }
      if (hash) { return this._index.getEntryIndex(hash) }
      return 0
    }
    const start = getStartIndex(opts.start, opts.hash)
    const end = opts.end || start + 20
    const entryHashes = Array.from(this._index._index).reverse().slice(start, end)

    let entries = []
    for (const entryHash of entryHashes) {
      const entry = await this._oplog.get(entryHash)
      entries.push(entry)
    }
    return entries
  }

  add (data, contact) {
    const entry = new FeedEntry().create(data, contact)
    return this._addOperation(entry)
  }

  static get type () {
    return 'recordfeedstore'
  }
}

module.exports = RecordFeedStore
