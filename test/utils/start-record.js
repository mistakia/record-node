const path = require('path')
const rimraf = require('rimraf')
const Record = require('../../index')
const debug = require('debug')

debug.enable('record:node:*')

const startRecord = (opts, node2) => new Promise((resolve, reject) => {
  const recordOpts = {
    api: false,
    orbitdb: {
      directory: path.join(opts.directory, './orbitdb/')
    },
    keystore: path.join(opts.directory, './keystore'),
    cache: path.join(opts.directory, './cache'),
    ipfs: {
      config: {
        Addresses: {
          Swarm: [
            '/ip4/127.0.0.1/tcp/0'
          ]
        },
        Discovery: {
          MDNS: {
            Enabled: true,
            Interval: 1
          }
        }
      }
    },
    ...opts
  }

  rimraf.sync(opts.directory)

  const record = new Record(recordOpts)
  record.on('error', (err) => {
    reject(err)
  })

  setTimeout(() => reject(new Error('peer timed out')), 25000)

  record.on('redux', ({ type, payload }) => {
    if (!node2) {
      return
    }

    if (type === 'RECORD_PEER_JOINED' && payload.logAddress === node2.address) {
      resolve(record)
    }
  })

  record.on('ready', () => {
    if (!node2) resolve(record)
  })

  record.init()
})

module.exports = startRecord
