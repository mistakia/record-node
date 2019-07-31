#!/usr/bin/env node
const os = require('os')
const fs = require('fs')
const path = require('path')

const debug = require('debug')
const Logger = require('logplease')
const argv = require('yargs').argv

const RecordNode = require('../index')

process.on('unhandledRejection', error => console.log(error))

debug.enable('record:*,ipfs:*')
Logger.setLogLevel(Logger.LogLevels.DEBUG)

const name = `record${(argv.name || argv.n || '')}`
console.log(`Node Name: ${name}`)

const recorddir = path.resolve(os.homedir(), `./.${name}`)
if (!fs.existsSync(recorddir)) { fs.mkdirSync(recorddir) }

let opts = {
  orbitdb: {
    directory: path.resolve(recorddir, './orbitdb')
  },
  ipfs: {
    repo: path.resolve(recorddir, './ipfs')
  }
}

if (argv.api) {
  const port = argv.port || 8080
  opts.api = { port }
}

try {
  const record = new RecordNode(opts)
  record.on('ready', async () => {
    const aboutData = {
      name: `${name}`,
      bio: 'dweb > web',
      location: 'not on the world wide web'
    }
    const about = await record.about.set(aboutData)
    console.log(about)

    const feedEntries = await record.feed.list()
    console.log(`${feedEntries.length} items in feed`)

    try {
      const track = await record.tracks.addTrackFromUrl('https://soundcloud.com/asa-moto101/kifesh?in=deewee-2/sets/asa-moto-playtime-deewee030')
      console.log(track)
    } catch (e) {
      console.log(e)
    }

    try {
      const tracks = await record.tracks.list(record.address, { query: 'kifesh' })
      console.log(tracks)
    } catch (e) {
      console.log(e)
    }

    try {
      setTimeout(async () => {
        await record.contacts.connect()
        await record.contacts.add({ address: '/orbitdb/zdpuB13FxzpXQjHggqHsLkPWeXDabcPucNs7vesGRaBHgaqxU/record' })
      }, 5000)

      record.on('redux', (data) => {
        if (data.type === 'CONTACT_REPLICATE_PROGRESS') {
          const { replicationStatus, replicationStats } = data.payload
          const progress = Math.max(replicationStats.tasksProcessed, replicationStatus.progress)
          const percent = Math.round((progress / replicationStatus.max) * 100)
          console.log(`Replication: ${percent}%`)
        }
      })
    } catch (e) {
      console.log(e)
    }
  })
} catch (e) {
  console.log(e)
}
