const Store = require('orbit-db-store')

const RecordIndex = require('./RecordIndex')
const tracks = require('./type/tracks')
const contacts = require('./type/contacts')
const tags = require('./type/tags')
const about = require('./type/about')

function throttled (delay, fn) {
  let lastCall = 0
  return function (...args) {
    const now = (new Date()).getTime()
    if (now - lastCall < delay) {
      return
    }
    lastCall = now
    return fn(...args)
  }
}

class RecordStore extends Store {
  constructor (ipfs, id, dbname, options = {}) {
    if (!options.indexBy) Object.assign(options, { indexBy: 'id' })
    if (!options.Index) Object.assign(options, { Index: RecordIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordStore.type

    this.tracks = tracks(this)
    this.contacts = contacts(this)
    this.tags = tags(this)
    this.about = about(this)

    this._replicator.on('load.progress', (id, hash, entry) => {
      this._index.process(entry)
    })
  }

  get (id, type) {
    if (type !== 'track' && type !== 'contact') {
      throw new Error(`Invalid type: ${type}`)
    }

    const hash = this._index.getEntryHash(id, type)
    if (!hash) {
      return null
    }

    return this._oplog.get(hash) // async
  }

  put (doc) {
    if (!doc[this.options.indexBy]) {
      throw new Error(`The provided document doesn't contain field '${this.options.indexBy}'`)
    }

    return this._addOperation({
      op: 'PUT',
      key: doc[this.options.indexBy],
      value: doc
    }) // async
  }

  del (id, type) {
    if (type !== 'track' && type !== 'contact') {
      throw new Error(`Invalid type: ${type}`)
    }

    if (!this._index.has(id, type)) {
      throw new Error(`No entry with id '${id}' in the database`)
    }

    return this._addOperation({
      op: 'DEL',
      key: id,
      value: { type, timestamp: Date.now() }
    }) // async
  }

  async close () {
    await super.close()

    this.events.removeAllListeners('contact')
    return Promise.resolve()
  }

  static get type () {
    return 'recordstore'
  }
}

module.exports = RecordStore
