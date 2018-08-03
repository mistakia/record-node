const Store = require('orbit-db-store')
const Log = require('ipfs-log')

const RecordIndex = require('./RecordIndex')

const tracks = require('./type/tracks')
const contacts = require('./type/contacts')

class RecordStore extends Store {
  constructor (ipfs, id, dbname, options) {
    if (!options) options = {}
    if (!options.indexBy) Object.assign(options, { indexBy: '_id' })
    if (!options.Index) Object.assign(options, { Index: RecordIndex })
    super(ipfs, id, dbname, options)
    this._type = RecordStore.type

    // Overwrite oplog
    this._oplog = new Log(this._ipfs, this.id, null, null, null, this._key, this.access.write)

    this._index = new this.options.Index(this._uid, null, null, this._cache)

    this.tracks = tracks(this)
    this.contacts = contacts(this)
  }

  async load (amount) {
    console.log(`Loading Log: ${this.id}`)
    const localHeads = await this._cache.get('_localHeads') || []
    const remoteHeads = await this._cache.get('_remoteHeads') || []
    const nextsIndex = new Map(await this._cache.get('_nextsIndex') || null)
    const heads = localHeads.concat(remoteHeads)

    const initialTrack = await this._cache.get('_indexTrack')
    const initialContact = await this._cache.get('_indexContact')
    this._index = new this.options.Index(this._uid, initialTrack, initialContact, this._cache)

    console.log(`Cached nextsIndex length: ${nextsIndex.size}`)

    if (heads.length > 0) {
      this.events.emit('load', this.address.toString(), heads)

      if (nextsIndex.size) {
        console.log('Creating log with nextsIndex')
        let log = new Log(
          this._ipfs,
          this.id,
          null,
          heads,
          null,
          this._key,
          this.access.write,
          nextsIndex
        )
        await this._oplog.join(log, amount)
      } else {
        console.log('Creating log from heads')
        for (const head of heads) {
          this._recalculateReplicationMax(head.clock.time)
          let log = await Log.fromEntryHash(
            this._ipfs,
            head.hash,
            this._oplog.id,
            amount,
            [],
            this._key,
            this.access.write,
            this._onLoadProgress.bind(this)
          )
          await this._oplog.join(log, amount)
        }
        await this._cache.set('_nextsIndex', Array.from(this._oplog._nextsIndex.entries()))
      }

      console.log(`Oplog nextsIndex length: ${this._oplog._nextsIndex.size}`)
      await this._updateIndex()
    }

    this.events.emit('ready', this.address.toString(), this._oplog.heads)
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

    if (!this._index.get(id, type)) {
      throw new Error(`No entry with id '${id}' in the database`)
    }

    return this._addOperation({
      op: 'DEL',
      key: id,
      value: null
    }) // async
  }

  async close () {
    await super.close()

    this.events.removeAllListeners('contact')
    return Promise.resolve()
  }

  async _addOperation (data, batchOperation, lastOperation, onProgressCallback) {
    if (this._oplog) {
      const entry = await this._oplog.append(data, this.options.referenceCount)
      this._recalculateReplicationStatus(this.replicationStatus.progress + 1, entry.clock.time)
      await this._cache.set('_localHeads', [entry])
      await this._cache.set('_nextsIndex', Array.from(this._oplog._nextsIndex.entries()))
      await this._updateIndex()
      this.events.emit('write', this.address.toString(), entry, this._oplog.heads)
      if (onProgressCallback) onProgressCallback(entry)
      return entry.hash
    }
  }

  static get type () {
    return 'recordstore'
  }
}

module.exports = RecordStore
