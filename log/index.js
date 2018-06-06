const extend = require('deep-extend')

const tracks = require('./tracks')
const contacts = require('./contacts')

const defaultOptions = {
  replicationConcurrency: 128,
  replicate: true
}

class RecordLog {
  constructor (orbitdb, address = 'record', options = {}) {
    this._orbitdb = orbitdb
    this._address = address
    this._options = extend(defaultOptions, options)

    this.tracks = tracks(this)
    this.contacts = contacts(this)
  }

  async load () {
    this._log = await this._orbitdb.docs(this._address, this._options)
    this.address = this._log.address
    this.key = this._log.key

    await this._log.load()
  }
}

module.exports = RecordLog
