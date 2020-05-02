const EventEmitter = require('events')
const path = require('path')
const fs = require('fs')

const { sha256 } = require('crypto-hash')
const crypto = require('libp2p-crypto')
const extend = require('deep-extend')
const debug = require('debug')
const OrbitDB = require('orbit-db')
const resolver = require('record-resolver')
const Keystore = require('orbit-db-keystore')
const Cache = require('orbit-db-cache')
const Storage = require('orbit-db-storage-adapter')
const Identities = require('orbit-db-identity-provider')
const secp256k1 = require('secp256k1')
const leveldown = require('leveldown')
const { CID } = require('ipfs-http-client')

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
    privateKey: keys.marshal().toString('hex'),
    privateKeyBytes: keys.bytes.toString('hex')
  }
}

const getKey = async (id, storage) => {
  const keys = await storage.getKey(id)
  const decompressedKey = secp256k1.publicKeyConvert(keys.public.marshal(), false)
  return {
    publicKey: decompressedKey.toString('hex'),
    privateKey: keys.marshal().toString('hex'),
    privateKeyBytes: keys.bytes.toString('hex')
  }
}

const createKeyFromPk = async (pk) => {
  const keys = await crypto.keys.unmarshalPrivateKey(Buffer.from(pk, 'hex'))
  const decompressedKey = secp256k1.publicKeyConvert(keys.public.marshal(), false)
  return {
    publicKey: decompressedKey.toString('hex'),
    privateKey: keys.marshal().toString('hex'),
    privateKeyBytes: keys.bytes.toString('hex')
  }
}

OrbitDB.addDatabaseType(RecordStore.type, RecordStore)
OrbitDB.addDatabaseType(ListensStore.type, ListensStore)

class RecordNode extends EventEmitter {
  constructor (options = {}) {
    super()

    this.logger = debug('record:node')
    this.logger.log = console.log.bind(console) // log to stdout instead of stderr
    this.logger.error = debug('record:node:err')

    this._options = extend(defaultConfig, options)
    this.logger(this._options)

    this._options.orbitdb.storage = Storage(leveldown)
    this._options.orbitdb.directory = path.resolve(this._options.directory, './orbitdb')

    this.resolve = resolver
    if (this._options.youtubedlPath) resolver.setYtdlBinary(this._options.youtubedlPath)

    this.isValidAddress = OrbitDB.isValidAddress
    this.parseAddress = OrbitDB.parseAddress

    this.about = components.about(this)
    this.bootstrap = components.bootstrap(this)
    this.logs = components.logs(this)
    this.importer = components.importer(this)
    this.info = components.info(this)
    this.listens = components.listens(this)
    this.log = components.log(this)
    this.tags = components.tags(this)
    this.tracks = components.tracks(this)
    this.peers = components.peers(this)

    // A mapping of cached log addresses to access controller addresses
    this._logAddresses = {}
    this._gcLock = false
    this._gcPosition = 0
    this._gcInterval = this._options.gcInterval
    this._bwStats = {}
    this._repoStats = {}

    if (this._options.api) {
      this._api = components.api(this)
    }

    if (!fs.existsSync(this._options.directory)) {
      fs.mkdirSync(this._options.directory, { recursive: true })
    }
  }

  static async createFromKey (pk, opts = {}) {
    opts.key = await createKeyFromPk(pk)
    return new RecordNode(opts)
  }

  get address () {
    return this._log.address.toString()
  }

  get identity () {
    return this._log.identity.id
  }

  isMe (logAddress) {
    return this.address === logAddress
  }

  async init (ipfsAPI) {
    await this._startIPFS(ipfsAPI)
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

  async _startIPFS (ipfsAPI) {
    this._ipfs = ipfsAPI
    this._ipfs.repo.has = async (cid) => {
      for await (const ref of this._ipfs.refs.local()) {
        if (ref.err) {
          this.logger.error(ref.err)
        } else if (cid.equals(new CID(ref.ref))) {
          return true
        }
      }
      return false
    }
    this._ipfs.repo.stat().then(repoStats => { this._repoStats = repoStats })
  }

  async _init (key, address) {
    await this._createKeystore()

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

    await this._createCache()
    await this._loadCache()

    this._orbitdb = await OrbitDB.createInstance(this._ipfs, this._options.orbitdb)

    await this.log._init(address)
    await this.listens._init()
    await this.importer.init()

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
    } catch (e) {
      this.logger.error(e)
    }
  }

  async restart () {
    await this.stop()
    await this.start()
  }

  async start () {
    this.info._init()

    const id = await this._ipfs.id()
    if (!id) {
      throw new Error('ipfs not available')
    }

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
      const entries = await log.logs.all()
      const logAddresses = entries.map(e => e.payload.value.content.address)
      for (const logAddress of logAddresses) {
        const l = await this.log.get(logAddress)
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
    return this.setIdentity(keys.privateKeyBytes)
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

  async _createKeystore () {
    const keystorePath = path.resolve(this._options.directory, './keystore')
    if (!fs.existsSync(keystorePath)) {
      fs.mkdirSync(keystorePath, { recursive: true })
    }
    this._keyStorage = await this._options.orbitdb.storage.createStore(keystorePath)
    this._options.orbitdb.keystore = new Keystore(this._keyStorage)
  }

  async _createCache () {
    const cachePath = path.resolve(this._options.directory, './cache')
    if (!fs.existsSync(cachePath)) {
      fs.mkdirSync(cachePath, { recursive: true })
    }
    this._cacheStorage = await this._options.orbitdb.storage.createStore(cachePath)
    this._options.orbitdb.cache = new Cache(this._cacheStorage)
  }

  async _loadCache () {
    const keys = []
    this._cacheStorage.createKeyStream().on('data', (data) => {
      const key = data.toString()
      keys.push(key)
    }).on('close', async () => {
      const deleteLogIds = []

      // Find log manifests to either load or delete from cache
      for (const key of keys) {
        if (key.match(manifestRe)) {
          const value = await this._cacheStorage.get(key)
          const manifestAddress = JSON.parse(value.toString())
          const manifest = await this._ipfs.dag.get(new CID(manifestAddress))
          const logAddress = `/orbitdb/${manifestAddress}/${manifest.value.name}`
          if (manifest.value.type === 'recordstore') {
            const { accessController } = manifest.value
            const haveAccessController = await this.log.haveAccessController(accessController)
            if (haveAccessController) {
              this._logAddresses[logAddress] = accessController
            } else {
              deleteLogIds.push(logAddress)
            }
          }
        }
      }

      for (const key of keys) {
        for (const logAddress of deleteLogIds) {
          const shouldDelete = key.includes(logAddress)
          if (shouldDelete) {
            this.logger(`Deleting cache for stale log: ${key}`)
            this._cacheStorage.del(key)
          }
        }
      }
    })
  }
}

module.exports = RecordNode
