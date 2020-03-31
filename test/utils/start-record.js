const path = require('path')
const rimraf = require('rimraf')
const Record = require('../../index')

const startRecord = (opts, node2) => new Promise((resolve, reject) => {
  const recordOpts = {
    api: false,
    orbitdb: {
      directory: path.join(opts.directory, './orbitdb/')
    },
    keystore: path.join(opts.directory, './keystore'),
    cache: path.join(opts.directory, './cache'),
    ...opts
  }

  rimraf.sync(opts.directory)

  const record = new Record(recordOpts)
  record.on('error', (err) => {
    reject(err)
  })

  setTimeout(() => reject(new Error('peer timed out')), 25000)

  record.on('redux', ({ type, payload }) => {
    if (type === 'RECORD_PEER_JOINED' && payload.logId === node2.address) {
      resolve(record)
    }
  })

  record.on('ready', () => {
    if (!node2) resolve(record)
  })

  record.init()
})

module.exports = startRecord
