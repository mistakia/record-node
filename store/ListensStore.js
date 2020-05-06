const RecordStore = require('./RecordStore')
const ListensIndex = require('./ListensIndex')

class ListensStore extends RecordStore {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.Index) Object.assign(options, { Index: ListensIndex })
    super(ipfs, id, dbname, options)
    this._type = ListensStore.type
  }

  async list ({ start = 0, limit = 20 } = {}) {
    const end = start + limit
    const entryHashes = Array.from(this._oplog._hashIndex.keys()).reverse().slice(start, end)
    const entries = []
    for (const entryHash of entryHashes) {
      const entry = await this._oplog.get(entryHash)
      entries.push(entry)
    }
    return entries.map(e => e.payload)
  }

  getCount (trackId) {
    return this._index.getCount(trackId)
  }

  async add ({ trackId, logAddress, cid }) {
    if (!trackId) {
      throw new Error('missing trackId')
    }

    if (!logAddress) {
      throw new Error('missing logAddress')
    }

    if (!cid) {
      throw new Error('missing cid')
    }

    const hash = await this._addOperation({
      trackId,
      logAddress,
      cid,
      timestamp: new Date().toString()
    })

    await this._ipfs.pin.add(hash, { recursive: false })

    return hash
  }

  static get type () {
    return 'listens'
  }
}

module.exports = ListensStore
