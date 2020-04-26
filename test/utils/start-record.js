const fs = require('fs')
const path = require('path')
const extend = require('deep-extend')
const Ctl = require('ipfsd-ctl')
const rimraf = require('rimraf')
const Record = require('../../index')
const debug = require('debug')

debug.enable('*')

const startRecord = (id, opts = {}) => new Promise((resolve, reject) => {
  const directory = path.join(__dirname, `../tmp/nodes/${id}`)
  try {
    rimraf.sync(directory)
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    console.log(error)
  }

  Ctl.createController({
    test: true,
    disposable: true,
    ipfsHttpModule: require('ipfs-http-client'),
    ipfsBin: require('go-ipfs-dep').path(),
    args: [
      '--enable-pubsub-experiment'
    ],
    ipfsOptions: {
      repo: directory,
      config: {
        Pubsub: {
          Router: 'gossipsub'
        },
        Addresses: {
          Swarm: [
            '/ip4/127.0.0.1/tcp/0/ws'
          ]
        },
        Discovery: {
          MDNS: {
            Enabled: false
          }
        },
        Swarm: {
          ConnMgr: {
            highWater: 2,
            lowWater: 1
          }
        }
      }
    }
  }).then((ipfsd) => {
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
      cache: path.join(directory, './cache')
    }
    const recordOpts = extend(defaultOpts, opts)
    const record = new Record(recordOpts)
    record.on('error', err => reject(err))
    record.on('ready', () => resolve(record))

    try {
      record.init(ipfsd.api)
    } catch (error) {
      reject(error)
    }
  })
})

module.exports = startRecord
