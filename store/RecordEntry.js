const { sha256 } = require('crypto-hash')
const { CID } = require('ipfs-http-client')

class Entry {
  constructor () {
    this._entry = {}
  }

  async create (ipfs, id, content, { pin = false } = {}) {
    this._entry = {
      id,
      timestamp: Date.now(),
      v: 0,
      type: this._type,
      ...this._entry
    }

    const cid = await ipfs.dag.put(content, { format: 'dag-cbor', hashAlg: 'sha3-512' })
    this._entry.content = cid

    if (pin) await ipfs.pin.add(cid.toString(), { recursive: false })

    return this._entry
  }
}

class TrackEntry extends Entry {
  constructor () {
    super()
    this._type = 'track'
  }

  async create (ipfs, content, { tags = [], pin = false } = {}) {
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

    return super.create(ipfs, id, content, { pin })
  }
}

class LogEntry extends Entry {
  constructor () {
    super()

    this._type = 'log'
  }

  async create (ipfs, content, options) {
    const id = await sha256(content.address)
    return super.create(ipfs, id, content, options)
  }
}

class AboutEntry extends Entry {
  constructor () {
    super()

    this._type = 'about'
  }

  async create (ipfs, content, options) {
    const id = await sha256(content.address)
    return super.create(ipfs, id, content, options)
  }
}

module.exports = {
  Entry,
  AboutEntry,
  TrackEntry,
  LogEntry
}
