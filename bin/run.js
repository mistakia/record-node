const os = require('os')
const fs = require('fs')
const path = require('path')

const debug = require('debug')
const Logger = require('logplease')
const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')

const RecordNode = require('../index')

debug.enable('record:*,jsipfs')
Logger.setLogLevel(Logger.LogLevels.DEBUG)

const recorddir = path.resolve(os.homedir(), './.record')
if (!fs.existsSync(recorddir)) { fs.mkdirSync(recorddir) }

const connManagerConfig = {
  maxPeers: 10,
  pollInterval: 30000
}

const ipfsConfig = {
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
        // '/dns4/ws-star.discovery.libp2p.io/tcp/443/wss/p2p-websocket-star'
      ]
    }
  }
}

const ipfs = new IPFS(ipfsConfig)

ipfs.on('ready', async () => {
  const opts = {
    orbitPath: path.resolve(recorddir, './orbitdb'),
    api: {
      port: 8080
    }
  }

  const rn = new RecordNode(ipfs, OrbitDB, opts)

  await rn.load()
  // ready
})
