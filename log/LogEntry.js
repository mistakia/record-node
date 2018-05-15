const crypto = require('crypto')

const Entry = require('./Entry')

class LogEntry extends Entry {
  constructor(data) {
    super(data)

    this._type = 'log'
  }

  create(data) {
    const hash = crypto.createHash('sha256')
    const id = hash.update(data.address).digest('hex')    
    return super.create(id, this._type, data)
  }
}

module.exports = LogEntry
