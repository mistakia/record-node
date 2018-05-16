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

const recorddir = path.resolve(os.homedir(), './.record')

if (!fs.existsSync(recorddir)){
  fs.mkdirSync(recorddir);
}

const defaults = {
  orbitPath: path.resolve(recorddir, './orbitdb'),
  ipfsConfig: {
    repo: path.resolve(recorddir, './ipfs'),
    init: true,
    pass: '2662d47e3d692fe8c2cdb70b907ebb12b216a9d9ca5110dd336d12e7bf86073b',
    EXPERIMENTAL: {
      pubsub: true
    },

    /* config: {
     *   Addresses: {
     *     Swarm: [
     *   	"/ip4/0.0.0.0/tcp/4002",
     *   	"/ip4/127.0.0.1/tcp/4003/ws",
     *   	"/dns4/wrtc-star.discovery.libp2p.io/tcp/443/wss/p2p-webrtc-star"
     *     ]
     *   }
     * },
     * libp2p: {
     *   modules: {
     *     transport: [wstar],
     *     discovery: [wstar.discovery]
     *   }
     * }
     */

    config: {
      Addresses: {
	Swarm: [
	  //'/ip4/0.0.0.0/tcp/4002',
	  //'/ip4/0.0.0.0/tcp/4003/ws'
	  //'/dns4/star-signal.cloud.ipfs.team/wss/p2p-webrtc-star'
	  //'/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star'
	]
      }
    }
  }
}


class RecordNode extends EventEmitter {
  constructor(options) {
    super()

    this._ipfs = null
    this._orbitdb = null
    this._options = extend(defaults, options || {})

    this.logger = debug('record:node')

    this._start()
  }


  _start() {
    this.logger('Starting RecordNode')
    this._ipfs = new IPFS(this._options.ipfsConfig)

    this._ipfs.on('error', (e) => this.emit('error', e))

    const self = this
    this._ipfs.on('ready', async () => {

      self._orbitdb = new OrbitDB(self._ipfs, self._options.orbitPath)

      const ipfsConfig = await self._ipfs.config.get()
      const ipfsInfo = await self._ipfs.id()
      self.logger(`IPFS ID: ${ipfsInfo.id}`)
      self.logger(`IPFS Config: ${JSON.stringify(ipfsConfig, null, 2)}`)
      self.logger(`Orbit ID: ${self._orbitdb.id}`)
      self.logger(`Orbit Dir: ${self._orbitdb.directory}`)

      self._log = new RecordLog(self._orbitdb)
      await self._log.load()

      self.logger(`Log Address: ${self._log._log.address}`)

      const logEntries = self._log.logs.all()

      self.logger('RecordNode Ready')
      self.emit('ready')

      self._logs = []
      logEntries.forEach(async (logEntry) => {
	const log = new RecordLog(logEntry.content.address)
	await log.load()
	self._logs.push(log)
      })
    })

    this._api = api(this)

    this._api.listen(3000, () => self.logger('RecordNode API listening on port 3000'))
  }

}

module.exports = RecordNode
