const path = require('path')
const rimraf = require('rimraf')
const Record = require('../../index')

const startRecord = (opts) => new Promise((resolve, reject) => {
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

  record.on('ready', () => {
    resolve(record)
  })
  record.init()
})

module.exports = startRecord
