const fs = require('fs')
const path = require('path')
const Ctl = require('ipfsd-ctl')
const rimraf = require('rimraf')
const exec = require('child_process').exec
const Record = require('../../index')

function hasLocal (ipfsBin, path) {
  const command = `${ipfsBin} dag stat --offline --config ${path}`
  return function (cid) {
    return new Promise((resolve, reject) => {
      exec(`${command} ${cid}`, (err, stdout, stderr) => {
        if (err || stderr.toLowerCase().includes('error')) {
          return reject(false)
        }
        resolve(true)
      })
    })
  }
}

const startRecord = (id, { restartable = false } = {}) => new Promise((resolve, reject) => {
  const directory = path.join(__dirname, `../tmp/nodes/${id}`)
  try {
    rimraf.sync(directory)
    fs.mkdirSync(directory, { recursive: true })
  } catch (error) {
    console.log(error)
  }

  const ipfsBin = require('go-ipfs').path()
  Ctl.createController({
    test: !restartable,
    disposable: !restartable,
    ipfsHttpModule: require('ipfs-http-client'),
    ipfsBin,
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

    ipfsd.hasLocal = hasLocal(ipfsBin, ipfsd.path)

    try {
      record.init(ipfsd)
    } catch (error) {
      reject(error)
    }
  })
})

module.exports = startRecord
