const EventEmitter = require('events')

const extend = require('deep-extend')
const debug = require('debug')
const IPFS = require('ipfs')
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
  address: 'record',
  bitboot: {
    enabled: true
  },
  orbitdb: {
    directory: undefined
  },
  ipfs: {
    init: {
      bits: 2048,
      emptyRepo: true
    },
    preload: {
      enabled: false
    },
    //repo: path.resolve(recorddir, './ipfs'),
    EXPERIMENTAL: {
      dht: false, // TODO: BRICKS COMPUTER
      pubsub: true
    },
    config: {
      Bootstrap: [],
      Addresses: {
	    Swarm: [
          //'/ip4/0.0.0.0/tcp/4002/',
          '/ip4/0.0.0.0/tcp/4003/ws/',
          '/ip4/206.189.77.125/tcp/9090/ws/p2p-websocket-star/'
	    ]
      }
    },
    libp2p: {
      config: {
        relay: {
          enabled: true,
          hop: {
            enabled: true,
            active: true
          }
        }
      }
    },
    connectionManager: {
      maxPeers: 100,
      minPeers: 10,
      pollInterval: 60000 // ms
    }
  }
}

class RecordNode extends EventEmitter {
  constructor (options = {}) {
    super()

    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    this._options = extend(defaultConfig, options)
    this.logger(this._options)

    this.isValidAddress = OrbitDB.isValidAddress
    this.parseAddress = OrbitDB.parseAddress

    this._ipfs = new IPFS(this._options.ipfs)
    this._ipfs.on('error', this.emit.bind(this))
    this._ipfs.on('ready', this._init.bind(this))
    this._ipfs.state.on('done', () => this.emit('ipfs:state', this._ipfs.state._state))

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

  async _init () {
    this._orbitdb = await OrbitDB.createInstance(this._ipfs, this._options.orbitdb)
    this.bootstrap.init()
    this.peers.init()
    await this.log.init()
    await this.feed.init()
    await this.listens.init()
    await this.contacts.init() // must initialize last

    this.emit('ready')
  }
}

module.exports = RecordNode
