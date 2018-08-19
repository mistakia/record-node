const os = require('os')
const fs = require('fs')
const path = require('path')

const debug = require('debug')
const Logger = require('logplease')
const IPFS = require('ipfs')
const OrbitDB = require('orbit-db')

const RecordNode = require('../index')

process.on('unhandledRejection', error => console.log(error))

debug.enable('record:*,jsipfs')
Logger.setLogLevel(Logger.LogLevels.INFO)

const recorddir = path.resolve(os.homedir(), './.record')
if (!fs.existsSync(recorddir)) { fs.mkdirSync(recorddir) }

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

  const record = new RecordNode(ipfs, OrbitDB, opts)

  await record.init()
  const address = '/orbitdb/Qma68c4H1kxUC3FboBXddB6TvGqFA4crShHDUqohJ3MZZK/record'
  const alias = 'Pi'
  await record.contacts.add({ address, alias })

  const profileData = {
    name: 'mistakia',
    bio: 'dweb > non-dweb',
    location: 'washington, dc'
  }

  const profile = await record.profile.set(profileData)
  console.log(profile)
  console.log(await record.profile.get('/me'))

  const feedEntries = await record.feed.list()
  console.log(`${feedEntries.length} items in feed`)
  // ready
})
