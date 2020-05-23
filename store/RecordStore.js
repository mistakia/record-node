const Store = require('orbit-db-store')

const RecordIndex = require('./RecordIndex')
const tracks = require('./type/tracks')
const logs = require('./type/logs')
const about = require('./type/about')

const { loadEntryContent } = require('../utils')

class RecordStore extends Store {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.indexBy) Object.assign(options, { indexBy: 'id' })
    if (!options.Index) Object.assign(options, { Index: RecordIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordStore.type

    this.tracks = tracks(this)
    this.logs = logs(this)
    this.about = about(this)
    this.beforePut = options.beforePut
    this.afterWrite = options.afterWrite
  }

  async getEntryWithContent (hash) {
    if (!hash) {
      return undefined
    }

    const entry = await this.get(hash)
    if (!entry) {
      return undefined
    }

    return loadEntryContent(this._ipfs, entry)
  }

  async get (hash) {
    if (!hash) {
      return undefined
    }

    return this._oplog.get(hash) // async
  }

  async put (doc) {
    if (!doc[this.options.indexBy]) {
      throw new Error(`The provided document doesn't contain field '${this.options.indexBy}'`)
    }

    if (this.beforePut) {
      await this.beforePut(doc, { id: this.id })
    }

    const entry = await this._addOperation({
      op: 'PUT',
      key: doc[this.options.indexBy],
      value: doc
    })

    if (this.afterWrite) {
      await this.afterWrite(entry)
    }

    // TODO (low) causes ~20% slowdown
    await this._ipfs.pin.add(entry.hash, { recursive: false })

    return entry
  }

  async del (id, type) {
    if (type !== 'track' && type !== 'log') {
      throw new Error(`Invalid type: ${type}`)
    }

    const entry = await this._addOperation({
      op: 'DEL',
      key: id,
      value: { type, timestamp: Date.now() }
    })

    if (this.afterWrite) {
      await this.afterWrite(entry)
    }

    await this._ipfs.pin.add(entry.hash, { recursive: false })

    return entry.hash
  }

  static get type () {
    return 'recordstore'
  }
}

module.exports = RecordStore
