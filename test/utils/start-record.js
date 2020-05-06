const fs = require('fs')
const path = require('path')
const Ctl = require('ipfsd-ctl')
const rimraf = require('rimraf')
const Record = require('../../index')
const debug = require('debug')

debug.enable('*')

const startRecord = (id, { restartable = false } = {}) => new Promise((resolve, reject) => {
  const directory = path.join(__dirname, `../tmp/nodes/${id}`)
  try {
    rimraf.sync(directory)
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    console.log(error)
  }

  Ctl.createController({
    test: !restartable,
    disposable: !restartable,
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
        Boostrap: null,
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
  }).then(async (ipfsd) => {
    if (restartable) {
      await ipfsd.init({
        bits: 2048,
        emptyRepo: true
      })

      await ipfsd.start()
    }

    const recordOpts = {
      directory,
      api: false,
      bitboot: { enabled: false }
    }
    const record = new Record(recordOpts)
    record.on('error', err => reject(err))
    record.on('ready', () => resolve({ record, ipfsd }))

    try {
      record.init(ipfsd.api)
    } catch (error) {
      reject(error)
    }
  })
})

module.exports = startRecord
