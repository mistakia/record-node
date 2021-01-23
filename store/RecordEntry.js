const { sha256 } = require('../utils')
const { CID } = require('ipfs-http-client')

class Entry {
  constructor () {
    this._entry = {}
  }

  async create (ipfs, id, content) {
    this._entry = {
      id,
      timestamp: Date.now(),
      v: 0,
      type: this._type,
      ...this._entry
    }

    const cid = await ipfs.dag.put(content, { format: 'dag-cbor', hashAlg: 'sha3-512' })
    this._entry.content = cid.toBaseEncodedString('base58btc')

    await ipfs.pin.add(cid.toString(), { recursive: false })

    return this._entry
  }
}

class TrackEntry extends Entry {
  constructor () {
    super()
    this._type = 'track'
  }

  async create (ipfs, content, { tags = [] } = {}) {
    const id = sha256(content.tags.acoustid_fingerprint)
    this._entry = {
      tags
    }

    if (content.hash && !CID.isCID(content.hash)) {
      content.hash = new CID(content.hash)
    }

    if (content.artwork && content.artwork.length) {
      content.artwork = content.artwork.map((a) => {
        return CID.isCID(a) ? a : new CID(a)
      })
    }

    return super.create(ipfs, id, content)
  }
}

class LogEntry extends Entry {
  constructor () {
    super()

    this._type = 'log'
  }

  async create (ipfs, content) {
    const id = sha256(content.address)
    return super.create(ipfs, id, content)
  }
}

class AboutEntry extends Entry {
  constructor () {
    super()

    this._type = 'about'
  }

  async create (ipfs, content) {
    const id = sha256(content.address)
    return super.create(ipfs, id, content)
  }
}

module.exports = {
  Entry,
  AboutEntry,
  TrackEntry,
  LogEntry
}
