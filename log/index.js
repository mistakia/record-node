const tracks = require('./tracks')
const contacts = require('./contacts')

class RecordLog {
  constructor (orbitdb, address) {
    this._orbitdb = orbitdb
    this._address = address || 'record'

    this.tracks = tracks(this)
    this.contacts = contacts(this)
  }

  async load () {
    this._log = await this._orbitdb.docs(this._address)
    this.address = this._log.address
    this.key = this._log.key

    await this._log.load()
  }
}

module.exports = RecordLog
