const EventEmitter = require('events')

const { sha256 } = require('crypto-hash')
const crypto = require('libp2p-crypto')
const extend = require('deep-extend')
const debug = require('debug')
const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const resolver = require('record-resolver')
const Keystore = require('orbit-db-keystore')
const Storage = require('orbit-db-storage-adapter')
const Identities = require('orbit-db-identity-provider')
const secp256k1 = require('secp256k1')
const leveldown = require('leveldown')

const components = require('./components')
const {
  RecordStore,
  RecordFeedStore,
  RecordListensStore
} = require('./store')
const defaultConfig = require('./config')

const createKey = async () => {
  const genKeyPair = () => new Promise((resolve, reject) => {
    crypto.keys.generateKeyPair('secp256k1', 256, (err, key) => {
      if (!err) {
        resolve(key)
      }
      reject(err)
    })
  })

  const keys = await genKeyPair()
  const decompressedKey = secp256k1.publicKeyConvert(keys.public.marshal(), false)
  return {
    publicKey: decompressedKey.toString('hex'),
    privateKey: keys.marshal().toString('hex')
  }
}

const getKey = async (id, storage) => {
  const keys = await storage.getKey(id)
  const decompressedKey = secp256k1.publicKeyConvert(keys.public.marshal(), false)
  return {
    publicKey: decompressedKey.toString('hex'),
    privateKey: keys.marshal().toString('hex')
  }
}

const createKeyFromPk = async (pk) => {
  const getKey = (pk) => new Promise((resolve, reject) => {
    crypto.keys.supportedKeys.secp256k1.unmarshalSecp256k1PrivateKey(pk, (err, key) => {
      if (!err) {
        resolve(key)
      }
      reject(err)
    })
  })

  const key = await getKey(Buffer.from(pk, 'hex'))
  const decompressedKey = secp256k1.publicKeyConvert(key.public.marshal(), false)

  return {
    publicKey: decompressedKey.toString('hex'),
    privateKey: key.marshal().toString('hex')
  }
}

OrbitDB.addDatabaseType(RecordStore.type, RecordStore)
OrbitDB.addDatabaseType(RecordFeedStore.type, RecordFeedStore)
OrbitDB.addDatabaseType(RecordListensStore.type, RecordListensStore)

class RecordNode extends EventEmitter {
  constructor (options = {}) {
    super()

    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    this._options = extend(defaultConfig, options)
    this.logger(this._options)

    this._ipfs = new IPFS(this._options.ipfs)
    this._ipfs.on('error', this.emit.bind(this))
    this._ipfs.on('ready', this._ready.bind(this))
    this._ipfs.state.on('done', () => this.emit('ipfs:state', this._ipfs.state._state))

    this.resolve = resolver
    this.isValidAddress = OrbitDB.isValidAddress
    this.parseAddress = OrbitDB.parseAddress

    this.about = components.about(this)
    this.bootstrap = components.bootstrap(this)
    this.contacts = components.contacts(this)
    this.feed = components.feed(this)
    this.info = components.info(this)
    this.listens = components.listens(this)
    this.log = components.log(this)
    this.tags = components.tags(this)
    this.tracks = components.tracks(this)
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

  async _ready () {
    await this._init(this._options.key, this._options.address)

    const ipfs = await this._ipfs.id()
    this.emit('ready', {
      id: this._id,
      orbitdb: {
        address: this._log.address.toString(),
        publicKey: this._log.identity.publicKey
      },
      ipfs
    })
  }

  async _init (key, address) {
    this._options.orbitdb.storage = Storage(leveldown)
    this._keystorage = await this._options.orbitdb.storage.createStore(this._options.keystore)
    this._options.orbitdb.keystore = new Keystore(this._keystorage)

    if (!key) {
      if (this._options.id) {
        key = await getKey(this._options.id, this._options.orbitdb.keystore)
      } else {
        key = await createKey()
      }
    }

    this._id = await sha256(key.publicKey)
    this._keystorage.put(this._id, JSON.stringify(key))

    this._options.orbitdb.identity = await Identities.createIdentity({
      id: this._id,
      keystore: this._options.orbitdb.keystore
    })

    this._orbitdb = await OrbitDB.createInstance(this._ipfs, this._options.orbitdb)

    await this.log._init(address)
    await this.feed._init()
    await this.listens._init()

    this.bootstrap._init()
    this.peers._init()
  }

  async stop () {
    const closeAPI = () => new Promise((resolve, reject) => {
      if (!this._api) {
        return resolve()
      }

      this._api.close((err) => {
        if (err) {
          return reject(err)
        }
        resolve()
      })
    })

    await Promise.all([
      closeAPI(),
      this.bootstrap._stop(),
      this._orbitdb.stop(),
      this.peers._stop()
    ])

    await this._ipfs.stop()
  }

  async start () {
    this.info._init()

    await this._ipfs.start()

    this._orbitdb = await OrbitDB.createInstance(this._ipfs, this._options.orbitdb)

    if (this._options.api) {
      this._api = components.api(this)
    }

    this.bootstrap._init()
    this.peers._init()
  }

  async getKeys () {
    const keys = await getKey(this._options.id, this._options.orbitdb.keystore)
    return keys
  }

  async setIdentity (pk) {
    await Promise.all([
      this.bootstrap._stop(),
      this._orbitdb.stop(),
      this.peers._stop()
    ])

    const key = await createKeyFromPk(pk)
    await this._init(key)

    const data = {
      id: this._id,
      orbitdb: {
        address: this._log.address.toString(),
        publicKey: this._log.identity.publicKey
      }
    }
    this.emit('id', data)
    return data
  }

  static async createFromKey (pk, opts = defaultConfig) {
    opts.key = await createKeyFromPk(pk)
    return new RecordNode(opts)
  }
}

module.exports = RecordNode
