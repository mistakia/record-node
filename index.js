const extend = require('deep-extend')
const debug = require('debug')

const components = require('./components')
const api = require('./api')

const RecordLog = require('./log')

const getDefaultConfig = () => {
  const defaults = {
    orbitPath: undefined,
    orbitAddress: undefined
  }

  return defaults
}

class RecordNode {
  constructor (ipfs, OrbitDB, options = {}) {
    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    const defaults = getDefaultConfig()
    this._options = extend(defaults, options)
    this.logger(this._options)

    this._ipfs = ipfs
    this._orbitdb = new OrbitDB(this._ipfs, this._options.orbitPath)
    this._log = new RecordLog(this._orbitdb, this._options.orbitAddress, this._options.logConfig)

    this._contacts = {}

    /* const ipfsConfig = await this._ipfs.config.get()
     * const ipfsInfo = await this._ipfs.id()
     * this.logger(`IPFS ID: ${ipfsInfo.id}`)
     * this.logger(`IPFS Config: ${JSON.stringify(ipfsConfig, null, 2)}`)
     * this.logger(`Orbit ID: ${this._orbitdb.id}`)
     * this.logger(`Orbit Dir: ${this._orbitdb.directory}`)
     */

    this.info = components.info(this)

    if (this._options.api) {
      this._api = api(this)
    }
  }

  async load () {
    await this._log.load()
    this.logger(`Log Address: ${this._log._log.address}`)
  }

  syncContacts () {
    this.logger('Loading contacts to sync')

    this._log.contacts.all().forEach(async (contact) => {
      const { address } = contact.content
      if (this._contacts[address]) { return }

      this.logger(`Loading contact: ${address}`)
      const opts = { replicate: true }
      const log = new RecordLog(this._orbitdb, address, opts)
      await log.load()
      this._contacts[address] = log
    })
    this.logger(`All contacts loaded`)
  }

  async getLog (logId) {
    if (!logId || logId === '/me') {
      return this._log
    }

    // TODO: localOnly
    const opts = { replicate: false }
    const log = new RecordLog(this._orbitdb, logId, opts)
    await log.load()

    // TODO: cache?

    return log
  }
}

module.exports = RecordNode
