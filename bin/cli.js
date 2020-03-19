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

const id = argv.id
console.log(`Node Id: ${id}`)

const recorddir = path.resolve(os.homedir(), `./.${name}`)
if (!fs.existsSync(recorddir)) { fs.mkdirSync(recorddir) }

const opts = {
  keystore: path.resolve(recorddir, './keystore'),
  cache: path.resolve(recorddir, './cache'),
  orbitdb: {
    directory: path.resolve(recorddir, './orbitdb')
  },
  ipfs: {
    repo: path.resolve(recorddir, './ipfs')
  }
}

if (id) {
  opts.id = id
}

if (argv.api) {
  const port = argv.port || 8080
  opts.api = { port }
}

const main = async () => {
  const record = new RecordNode(opts)
  record.on('ready', async (data) => {
    console.log(data)

    try {
      const aboutData = {
        name: `${name}`,
        bio: 'dweb > web',
        location: 'not on the world wide web'
      }
      const about = await record.about.set(aboutData)
      console.log(about)
    } catch (e) {
      console.log(e)
    }
  })
  await record.init()
}

try {
  main()
} catch (e) {
  console.log(e)
}
