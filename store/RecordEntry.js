const { sha256 } = require('crypto-hash')
const { CID } = require('ipfs')

class Entry {
  constructor () {
    this._entry = {}
  }

  async create (ipfs, id, content, shouldPin) {
    this._entry = {
      id,
      timestamp: Date.now(),
      v: 0,
      type: this._type,
      ...this._entry
    }

    const cid = await ipfs.dag.put(content, { format: 'dag-cbor', hashAlg: 'sha3-512' })
    this._entry.content = cid

    // TODO
    // if (shouldPin) await ipfs.pin.add(cid)

    return this._entry
  }
}

class TrackEntry extends Entry {
  constructor () {
    super()
    this._type = 'track'
  }

  async create (ipfs, content, shouldPin, tags = []) {
    const id = await sha256(content.tags.acoustid_fingerprint)
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

    return super.create(ipfs, id, content, shouldPin)
  }
}

class LogEntry extends Entry {
  constructor () {
    super()

    this._type = 'log'
  }

  async create (ipfs, content, shouldPin) {
    const id = await sha256(content.address)
    return super.create(ipfs, id, content, shouldPin)
  }
}

class AboutEntry extends Entry {
  constructor () {
    super()

    this._type = 'about'
  }

  async create (ipfs, content, shouldPin) {
    const id = await sha256(content.address)
    return super.create(ipfs, id, content, shouldPin)
  }
}

module.exports = {
  Entry,
  AboutEntry,
  TrackEntry,
  LogEntry
}
