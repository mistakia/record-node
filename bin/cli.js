#!/usr/bin/env node
process.on('unhandledRejection', error => console.log(error))

const os = require('os')
const fs = require('fs')
const path = require('path')
const createIPFSDaemon = require('record-ipfsd')
const argv = require('yargs').argv

const RecordNode = require('../index')

const getIpfsBinPath = () => require('go-ipfs').path()

const name = `record${(argv.name || argv.n || '')}`
console.log(`[cli] Node Name: ${name}`)

const recorddir = path.resolve(os.homedir(), `./.${name}`)
if (!fs.existsSync(recorddir)) { fs.mkdirSync(recorddir) }
console.log(`[cli] Node Path: ${recorddir}`)

const opts = { directory: recorddir }
const id = argv.id
console.log(`[cli] Node Id: ${id}`)

if (id) {
  opts.id = id
}

if (argv.api) {
  const port = argv.port || 8080
  opts.api = { port }
}

const main = async () => {
  const ipfsd = await createIPFSDaemon({
    repo: path.resolve(recorddir, 'ipfs'),
    ipfsBin: getIpfsBinPath()
  })

  const record = new RecordNode(opts)
  record.on('ready', async (data) => {
    console.log('[cli]', data)
    try {
      const aboutData = {
        name: `${name}`,
        bio: 'dweb > web',
        location: 'not on the world wide web'
      }
      const about = await record.about.set(aboutData)
      console.log('[cli]', about)
    } catch (e) {
      console.log(e)
    }
  })

  await record.init(ipfsd)
}

try {
  main()
} catch (e) {
  console.log(e)
}
