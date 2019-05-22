const extend = require('deep-extend')
const debug = require('debug')
const OrbitDB = require('orbit-db')

const resolver = require('record-resolver')

const components = require('./components')

const {
  RecordStore,
  RecordFeedStore,
  RecordListensStore
} = require('./store')

OrbitDB.addDatabaseType(RecordStore.type, RecordStore)
OrbitDB.addDatabaseType(RecordFeedStore.type, RecordFeedStore)
OrbitDB.addDatabaseType(RecordListensStore.type, RecordListensStore)

const defaultConfig = {
  api: false,
  bitboot: {
    enabled: true
  },
  orbitdb: {
    directory: undefined
  }
}

class RecordNode {
  constructor (ipfs, options = {}) {
    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    this._options = extend(defaultConfig, options)
    this.logger(this._options)

    this.isValidAddress = OrbitDB.isValidAddress
    this.parseAddress = OrbitDB.parseAddress

    this._ipfs = ipfs

    this.resolve = resolver

    this.bootstrap = components.bootstrap(this)
    this.contacts = components.contacts(this)
    this.feed = components.feed(this)
    this.info = components.info(this)
    this.listens = components.listens(this)
    this.log = components.log(this)
    this.suggested = components.suggested(this)
    this.tags = components.tags(this)
    this.tracks = components.tracks(this)
    this.profile = components.profile(this)
    this.peers = components.peers(this)

    if (this._options.api) {
      this._api = components.api(this)
    }
  }

  get address () {
    return this._log.address.toString()
  }

  isMe (logId) {
    return this.address === logId
  }

  async init (address) {
    this._orbitdb = await OrbitDB.createInstance(this._ipfs, this._options.orbitdb)
    await this.bootstrap.init()
    this.peers.init()
    await this.log.init(address)
    await this.feed.init()
    await this.listens.init()
    await this.contacts.init() // must initialize last
  }
}

module.exports = RecordNode
