#!/usr/bin/env node
const os = require('os')
const fs = require('fs')
const path = require('path')

const debug = require('debug')
const Logger = require('logplease')
const IPFS = require('ipfs')
const argv = require('yargs').argv

const RecordNode = require('../index')

process.on('unhandledRejection', error => console.log(error))

debug.enable('record:*,jsipfs')
Logger.setLogLevel(Logger.LogLevels.DEBUG)

const name = `record${(argv.name || argv.n || '')}`
console.log(`Node Name: ${name}`)

const recorddir = path.resolve(os.homedir(), `./.${name}`)
if (!fs.existsSync(recorddir)) { fs.mkdirSync(recorddir) }

const ipfsConfig = {
  repo: path.resolve(recorddir, './ipfs'),
  init: true,
  EXPERIMENTAL: {
    dht: false, // TODO: BRICKS COMPUTER
    pubsub: true
  },
  config: {
    Bootstrap: [],
    Addresses: {
      Swarm: [
        '/ip4/0.0.0.0/tcp/4002',
        '/ip4/0.0.0.0/tcp/4003/ws'
      ]
    }
  },
  libp2p: {
    config: {
      relay: {
        enabled: true
      }
    }
  }
}

const ipfs = new IPFS(ipfsConfig)

ipfs.on('error', console.log)

ipfs.on('ready', async () => {
  let opts = {
    orbitdb: {
      directory: path.resolve(recorddir, './orbitdb')
    }
  }

  if (argv.api) {
    const port = argv.port || 8080
    opts.api = { port }
  }

  const record = new RecordNode(ipfs, opts)
  await record.init()

  //TODO: remove
  const address = '/orbitdb/Qma68c4H1kxUC3FboBXddB6TvGqFA4crShHDUqohJ3MZZK/record'
  const alias = 'Pi'
  await record.contacts.add({ address, alias })

  const profileData = {
    name: `${name}`,
    bio: 'dweb > web',
    location: 'not on the world wide web'
  }
  const profile = await record.profile.set(profileData)

  const feedEntries = await record.feed.list()
  console.log(`${feedEntries.length} items in feed`)
  // ready
})
