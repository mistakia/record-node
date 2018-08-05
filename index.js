const extend = require('deep-extend')
const debug = require('debug')

const resolver = require('record-resolver')

const components = require('./components')

const {
  RecordStore,
  RecordFeedStore,
  RecordListensStore
} = require('./store')

const defaultConfig = {
  orbitPath: undefined
}

class RecordNode {
  constructor (ipfs, OrbitDB, options = {}) {
    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    this._options = extend(defaultConfig, options)
    this.logger(this._options)

    OrbitDB.addDatabaseType(RecordStore.type, RecordStore)
    OrbitDB.addDatabaseType(RecordFeedStore.type, RecordFeedStore)
    OrbitDB.addDatabaseType(RecordListensStore.type, RecordListensStore)
    this.isValidAddress = OrbitDB.isValidAddress
    this.parseAddress = OrbitDB.parseAddress

    this._ipfs = ipfs
    this._orbitdb = new OrbitDB(this._ipfs, this._options.orbitPath)

    this.resolve = resolver

    this.contacts = components.contacts(this)
    this.feed = components.feed(this)
    this.info = components.info(this)
    this.listens = components.listens(this)
    this.log = components.log(this)
    this.tags = components.tags(this)
    this.tracks = components.tracks(this)

    if (this._options.api) {
      this._api = components.api(this)
    }
  }

  async init (address) {
    await this.log.init(address)
    await this.feed.init()
    await this.contacts.init()
    await this.listens.init()
  }
}

module.exports = RecordNode
