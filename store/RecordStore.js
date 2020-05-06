const Store = require('orbit-db-store')

const RecordIndex = require('./RecordIndex')
const tracks = require('./type/tracks')
const logs = require('./type/logs')
const tags = require('./type/tags')
const about = require('./type/about')

class RecordStore extends Store {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.indexBy) Object.assign(options, { indexBy: 'id' })
    if (!options.Index) Object.assign(options, { Index: RecordIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordStore.type

    this.tracks = tracks(this)
    this.logs = logs(this)
    this.tags = tags(this)
    this.about = about(this)

    this._replicator.on('load.progress', (id, hash, entry) => {
      this._index.process(entry)
    })
  }

  get (id, type) {
    if (type !== 'track' && type !== 'log') {
      throw new Error(`Invalid type: ${type}`)
    }

    const hash = this._index.getEntryHash(id, type)
    if (!hash) {
      return null
    }

    return this._oplog.get(hash) // async
  }

  async put (doc, { pin }) {
    if (!doc[this.options.indexBy]) {
      throw new Error(`The provided document doesn't contain field '${this.options.indexBy}'`)
    }

    const hash = await this._addOperation({
      op: 'PUT',
      key: doc[this.options.indexBy],
      value: doc
    })

    if (pin) await this._ipfs.pin.add(hash, { recursive: false })

    return hash
  }

  async del (id, type, { pin }) {
    if (type !== 'track' && type !== 'log') {
      throw new Error(`Invalid type: ${type}`)
    }

    if (!this._index.has(id, type)) {
      throw new Error(`No entry with id '${id}' in the database`)
    }

    const hash = await this._addOperation({
      op: 'DEL',
      key: id,
      value: { type, timestamp: Date.now() }
    })

    if (pin) await this._ipfs.pin.add(hash, { recursive: false })

    return hash
  }

  async close () {
    if (this._index.save) await this._index.save() // TODO Listens store missing save
    await super.close()

    return Promise.resolve()
  }

  static get type () {
    return 'recordstore'
  }
}

module.exports = RecordStore
