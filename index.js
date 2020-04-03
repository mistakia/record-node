const EventEmitter = require('events')
const path = require('path')
const fs = require('fs')

const { sha256 } = require('crypto-hash')
const crypto = require('libp2p-crypto')
const extend = require('deep-extend')
const debug = require('debug')
const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')
const resolver = require('record-resolver')
const Keystore = require('orbit-db-keystore')
const Cache = require('orbit-db-cache')
const Storage = require('orbit-db-storage-adapter')
const Identities = require('orbit-db-identity-provider')
const secp256k1 = require('secp256k1')
const leveldown = require('leveldown')

const { CID } = IPFS
const manifestRe = /\/orbitdb\/[a-zA-Z0-9]+\/[^/]+\/_manifest/

const components = require('./components')
const {
  RecordStore,
  ListensStore
} = require('./store')
const defaultConfig = require('./config')

const createKey = async () => {
  const keys = await crypto.keys.generateKeyPair('secp256k1', 256)
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
  const keys = await crypto.keys.unmarshalPrivateKey(Buffer.from(pk, 'hex'))
  const decompressedKey = secp256k1.publicKeyConvert(keys.public.marshal(), false)
  return {
    publicKey: decompressedKey.toString('hex'),
    privateKey: keys.marshal().toString('hex')
  }
}

OrbitDB.addDatabaseType(RecordStore.type, RecordStore)
OrbitDB.addDatabaseType(ListensStore.type, ListensStore)

class RecordNode extends EventEmitter {
  constructor (options = {}) {
    super()

    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.err = debug('record:node:err')

    this._options = extend(defaultConfig, options)
    this.logger(this._options)

    this.resolve = resolver
    this.isValidAddress = OrbitDB.isValidAddress
    this.parseAddress = OrbitDB.parseAddress

    this.about = components.about(this)
    this.bootstrap = components.bootstrap(this)
    this.contacts = components.contacts(this)
    this.info = components.info(this)
    this.listens = components.listens(this)
    this.log = components.log(this)
    this.tags = components.tags(this)
    this.tracks = components.tracks(this)
    this.peers = components.peers(this)

    this._logs = {}
    this._gcLock = false
    this._gcPosition = 0
    this._gcInterval = this._options.gcInterval
    this._bwStats = {}
    this._repoStats = {}

    if (this._options.api) {
      this._api = components.api(this)
    }
  }

  async init () {
    if (!fs.existsSync(this._options.directory)) {
      fs.mkdirSync(this._options.directory, { recursive: true })
    }
    this._options.ipfs.repo = path.resolve(this._options.directory, './ipfs')
    this._ipfs = await IPFS.create(this._options.ipfs)
    await this._ready()
    // TODO this._ipfs.on('error', this.emit.bind(this))
    // TODO this._ipfs.on('ready', this._ready.bind(this))
    // TODO this._ipfs.state.on('done', () => this.emit('ipfs:state', this._ipfs.state._state))
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

    this._repoStats = await this._ipfs.repo.stat()
  }

  async _init (key, address) {
    this._options.orbitdb.storage = Storage(leveldown)

    const keystorePath = path.resolve(this._options.directory, './keystore')
    if (!fs.existsSync(keystorePath)) {
      fs.mkdirSync(keystorePath, { recursive: true })
    }
    this._keyStorage = await this._options.orbitdb.storage.createStore(keystorePath)
    this._options.orbitdb.keystore = new Keystore(this._keyStorage)

    if (!key) {
      if (this._options.id) {
        key = await getKey(this._options.id, this._options.orbitdb.keystore)
      } else {
        key = await createKey()
      }
    }

    this._id = await sha256(key.publicKey)
    await this._keyStorage.put(this._id, JSON.stringify(key))

    this._options.orbitdb.identity = await Identities.createIdentity({
      id: this._id,
      keystore: this._options.orbitdb.keystore
    })

    const cachePath = path.resolve(this._options.directory, './cache')
    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true })
    }
    this._cacheStorage = await this._options.orbitdb.storage.createStore(cachePath)
    this._options.orbitdb.cache = new Cache(this._cacheStorage)

    this._cacheStorage.createKeyStream().on('data', async (data) => {
      const key = data.toString()
      if (key.match(manifestRe)) {
        const dataValue = await this._cacheStorage.get(key)
        const manifestAddress = JSON.parse(dataValue.toString())
        const dagNode = await this._ipfs.dag.get(new CID(manifestAddress))
        const logId = `/orbitdb/${manifestAddress}/${dagNode.value.name}`
        if (dagNode.value.type === 'recordstore') {
          this._logs[logId] = dagNode.value.accessController
        }
      }
    })

    this._options.orbitdb.directory = path.resolve(this._options.directory, './orbitdb')
    this._orbitdb = await OrbitDB.createInstance(this._ipfs, this._options.orbitdb)

    await this.log._init(address)
    await this.listens._init()

    this.bootstrap._init()
    this.peers._init()

    this._bwStats = await this._ipfs.stats.bw()
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

    try {
      await Promise.all([
        closeAPI(),
        this.bootstrap._stop(),
        this._orbitdb.stop(),
        this.peers._stop()
      ])

      await this._ipfs.stop()
    } catch (e) {
      this.logger.err(e)
    }
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

  async gc () {
    /* if (this._gcLock) return

     * this._gcLock = true

     * this._bwStats = await this._ipfs.stats.bw()
     * if (this._bwStats.totalIn.minus(this._gcPosition) > this._gcInterval) {
     *   this.logger(`Running ipfs gc at ${this._gcPosition}`)
     *   await this._ipfs.repo.gc()
     *   this._gcPosition = this._bwStats.totalIn.toNumber()
     * }

     * this._repoStats = await this._ipfs.repo.stat()
     * this._gcLock = false */
  }

  async pinAC (accessControllerAddress) {
    const acAddress = accessControllerAddress.split('/')[2]
    await this._ipfs.pin.add(acAddress)
    const dagNode = await this._ipfs.dag.get(acAddress)
    await this._ipfs.pin.add(dagNode.value.params.address)
  }

  async checkContentPin ({ id, cid, type }) {
    if (type !== 'about') {
      const log = this.log.mine()
      const entries = await log.contacts.all()
      const logIds = entries.map(e => e.payload.value.content.address)
      for (const logId of logIds) {
        const l = await this.log.get(logId)
        const hasContent = !!l._index.getEntryHash(id, type)

        if (hasContent) {
          return
        }
      }
    }

    await this._ipfs.pin.rm(cid)
  }

  async getKeys () {
    const keys = await getKey(this._id, this._options.orbitdb.keystore)
    return keys
  }

  async createIdentity () {
    const keys = await createKey()
    return this.setIdentity(keys.privateKey)
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
