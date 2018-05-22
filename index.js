const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const EventEmitter = require('events')
const extend = require('deep-extend')
const path = require('path')
const os = require('os')
const fs = require('fs')
const debug = require('debug')

const api = require('./api')
const RecordLog = require('./log')

const getDefaultConfig = (recorddir) => {
  recorddir = recorddir || path.resolve(os.homedir(), './.record')

  const defaults = {
    path: recorddir,
    apiPort: 3000,
    orbitPath: path.resolve(recorddir, './orbitdb'),
    ipfsConfig: {
      repo: path.resolve(recorddir, './ipfs'),
      init: true,
      pass: '2662d47e3d692fe8c2cdb70b907ebb12b216a9d9ca5110dd336d12e7bf86073b',
      EXPERIMENTAL: {
        dht: true,
        relay: {
          enabled: true
        },
        pubsub: true
      },
      config: {
        Addresses: {
          Swarm: [
            // '/ip4/0.0.0.0/tcp/4002',
            // '/ip4/0.0.0.0/tcp/4003/ws',
            // '/dns4/star-signal.cloud.ipfs.team/wss/p2p-webrtc-star',
            '/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star'
          ]
        }
      }
    }
  }

  return defaults
}

class RecordNode extends EventEmitter {
  constructor (options) {
    super()

    options = options || {}

    this._ipfs = null
    this._orbitdb = null

    const defaults = getDefaultConfig(options.path)
    this._options = extend(defaults, options || {})

    if (!fs.existsSync(this._options.path)) { fs.mkdirSync(this._options.path) }

    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    this._log = null
    this._contacts = {}

    this._start()
  }

  _start () {
    this.logger('Starting RecordNode')

    this._ipfs = new IPFS(this._options.ipfsConfig)
    this._ipfs.on('error', (e) => this.emit('error', e))
    this._ipfs.on('ready', async () => {
      this._orbitdb = new OrbitDB(this._ipfs, this._options.orbitPath)

      const ipfsConfig = await this._ipfs.config.get()
      const ipfsInfo = await this._ipfs.id()
      this.logger(`IPFS ID: ${ipfsInfo.id}`)
      this.logger(`IPFS Config: ${JSON.stringify(ipfsConfig, null, 2)}`)
      this.logger(`Orbit ID: ${this._orbitdb.id}`)
      this.logger(`Orbit Dir: ${this._orbitdb.directory}`)

      this._log = new RecordLog(this._orbitdb)
      await this._log.load()
      this.logger(`Log Address: ${this._log._log.address}`)

      this._api = api(this)
      const { apiPort } = this._options
      this._api.listen(apiPort, () => this.logger(`API listening on port ${apiPort}`))

      this.logger('RecordNode Ready')
      this.emit('ready')

      this.loadContacts()
    })
  }

  loadContacts () {
    this.logger('Loading Contacts')

    this._log.contacts.all().forEach(async (contact) => {
      const { address } = contact.content
      if (this._contacts[address]) { return }

      this.logger(`Loading contact: ${address}`)
      const log = new RecordLog(this._orbitdb, address)
      await log.load()
      this._contacts[address] = log
    })
    this.logger(`All contacts loaded`)
  }
}

module.exports = RecordNode
