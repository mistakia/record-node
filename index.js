const extend = require('deep-extend')
const debug = require('debug')

const resolver = require('record-resolver')

const components = require('./components')
const api = require('./api')

const { RecordFeedStore, RecordStore } = require('./store')

const defaultConfig = {
  orbitPath: undefined,
  orbitAddress: 'record',
  storeConfig: {
    referenceCount: 24,
    replicationConcurrency: 128,
    localOnly: false,
    create: true,
    overwrite: true,
    replicate: false
  }
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

    this._ipfs = ipfs
    this._orbitdb = new OrbitDB(this._ipfs, this._options.orbitPath)

    /* const ipfsConfig = await this._ipfs.config.get()
     * const ipfsInfo = await this._ipfs.id()
     * this.logger(`IPFS ID: ${ipfsInfo.id}`)
     * this.logger(`IPFS Config: ${JSON.stringify(ipfsConfig, null, 2)}`)
     * this.logger(`Orbit ID: ${this._orbitdb.id}`)
     * this.logger(`Orbit Dir: ${this._orbitdb.directory}`)
     */

    this.info = components.info(this)
    this.contacts = components.contacts(this)
    this.feed = components.feed(this)
    this.resolve = resolver

    if (this._options.api) {
      this._api = api(this)
    }
  }

  async init (address = 'record') {
    const opts = extend(this._options.storeConfig, {
      replicate: true,
      type: RecordStore.type
    })

    // Open & Load Main Log
    this._log = await this._orbitdb.open(address, opts)
    this._log.events.on('contact', () => {
      this.contacts.sync()
    })
    await this._log.load()
    await this.feed.init()

    await this.contacts.sync()
  }

  async loadLog (logId, opts) {
    if (!logId || logId === '/me') {
      return this._log
    }

    if (logId === '/feed') {
      return this._feedLog
    }

    const log = await this.getLog(logId, opts)
    this.logger(`Loading log: ${log.address}`)
    await log.load()

    return log
  }

  async getLog (logId, options) {
    if (!logId || logId === '/me') {
      return this._log
    }

    const defaults = extend(defaultConfig.storeConfig, {
      type: RecordStore.type,
      create: false
    })
    const opts = extend(defaults, options)
    const log = await this._orbitdb.open(logId, opts)
    return log
  }
}

module.exports = RecordNode
