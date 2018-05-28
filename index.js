const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const EventEmitter = require('events')
const extend = require('deep-extend')
const path = require('path')
const os = require('os')
const fs = require('fs')
const debug = require('debug')
const ConnManager = require('libp2p-connection-manager')

const api = require('./api')
const RecordLog = require('./log')

const getDefaultConfig = (recorddir) => {
  recorddir = recorddir || path.resolve(os.homedir(), './.record')

  const defaults = {
    path: recorddir,
    apiPort: 3000,
    orbitPath: path.resolve(recorddir, './orbitdb'),
    connManagerConfig: {
      maxPeers: 10,
      pollInterval: 30000
    },
    ipfsConfig: {
      repo: path.resolve(recorddir, './ipfs'),
      init: true,
      EXPERIMENTAL: {
        dht: false, // TODO: BRICKS COMPUTER
        relay: {
          enabled: true,
          hop: {
            enabled: false, // TODO: CPU hungry on mobile
            active: false
          }
        },
        pubsub: true
      },
      config: {
        Bootstrap: [],
        Addresses: {
          Swarm: [
            // '/ip4/0.0.0.0/tcp/4002',
            // '/ip4/0.0.0.0/tcp/4003/ws',
            // '/dns4/star-signal.cloud.ipfs.team/wss/p2p-webrtc-star',
            '/ip4/159.203.117.254/tcp/9090/ws/p2p-websocket-star'
            //'/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star'
          ]
        }
      }
    }
  }

  return defaults
}

class RecordNode extends EventEmitter {
  constructor (options = {}) {
    super()

    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    const defaults = getDefaultConfig(options.path)
    this._options = extend(defaults, options)
    this.logger(this._options)

    if (!fs.existsSync(this._options.path)) { fs.mkdirSync(this._options.path) }

    this._ipfs = null
    this._orbitdb = null
    this._log = null
    this._contacts = {}

    this._start()
  }

  _start () {
    this.logger('starting')

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

      this.logger('ready')
      this.emit('ready')

      this.loadContacts()

      this.connManager = new ConnManager(this._ipfs._libp2pNode, this._options.connManagerConfig)

      // TODO: bootstrap fallback - use bitboot (https://github.com/tintfoundation/bitboot)
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
