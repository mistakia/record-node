const fs = require('fs')
const path = require('path')
const extend = require('deep-extend')
const rimraf = require('rimraf')
const Record = require('../../index')
const debug = require('debug')

debug.enable('record:node:*')

const startRecord = (id, opts = {}) => new Promise((resolve, reject) => {
  const directory = path.join(__dirname, `../tmp/nodes/${id}`)
  const defaultOpts = {
    directory,
    api: false,
    bitboot: {
      enabled: false
    },
    orbitdb: {
      directory: path.join(directory, './orbitdb/')
    },
    keystore: path.join(directory, './keystore'),
    cache: path.join(directory, './cache'),
    ipfs: {
      config: {
        Addresses: {
          Swarm: [
            '/ip4/127.0.0.1/tcp/0/ws'
          ]
        },
        Discovery: {
          MDNS: {
            Enabled: false
          }
        }
      }
    }
  }
  const recordOpts = extend(defaultOpts, opts)

  try {
    rimraf.sync(directory)
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    console.log(error)
  }

  const record = new Record(recordOpts)
  record.on('error', err => reject(err))
  record.on('ready', () => resolve(record))

  try {
    record.init()
  } catch (error) {
    reject(error)
  }
})

module.exports = startRecord
