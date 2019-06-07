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

    const profileData = {
      name: `${name}`,
      bio: 'dweb > web',
      location: 'not on the world wide web'
    }
    const profile = await record.profile.set(profileData)
    console.log(profile)

    const feedEntries = await record.feed.list()
    console.log(`${feedEntries.length} items in feed`)

    try {
      const track = await record.tracks.addTrackFromUrl('https://soundcloud.com/asa-moto101/kifesh?in=deewee-2/sets/asa-moto-playtime-deewee030')
      console.log(track)
    } catch (e) {
      console.log(e)
    }
  })
} catch (e) {
  console.log(e)
}
