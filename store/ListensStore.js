const RecordStore = require('./RecordStore')
const ListensIndex = require('./ListensIndex')

class ListensStore extends RecordStore {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.Index) Object.assign(options, { Index: ListensIndex })
    super(ipfs, id, dbname, options)
    this._type = ListensStore.type

    this.afterAdd = options.afterAdd
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

  async add ({ trackId, address }) {
    if (!trackId) {
      throw new Error('missing trackId')
    }

    const entry = await this._addOperation({
      trackId,
      address,
      timestamp: Date.now()
    })

    if (this.afterAdd) {
      await this.afterAdd(entry)
    }

    // TODO - enable pinning
    // await this._ipfs.pin.add(entry.hash, { recursive: false })

    return entry.hash
  }

  static get type () {
    return 'listens'
  }
}

module.exports = ListensStore
