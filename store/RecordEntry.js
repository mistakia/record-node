const { sha256 } = require('crypto-hash')
const { generateAvatar } = require('../utils')
const { CID } = require('ipfs')

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
    this._entry.content = cid

    return this._entry
  }
}

class TrackEntry extends Entry {
  constructor () {
    super()
    this._type = 'track'
  }

  async create (ipfs, content, tags = []) {
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

    return super.create(ipfs, id, content)
  }
}

class ContactEntry extends Entry {
  constructor () {
    super()

    this._type = 'contact'
  }

  async create (ipfs, content) {
    const id = await sha256(content.address)
    return super.create(ipfs, id, content)
  }
}

class FeedEntry {
  create ({ entryId, logId, entryType }) {
    this._entry = {
      entryId,
      logId,
      entryType,
      timestamp: Date.now()
    }

    return this._entry
  }
}

class AboutEntry extends Entry {
  constructor () {
    super()

    this._type = 'about'
  }

  async create (ipfs, content) {
    const id = await sha256(content.address)
    if (!content.avatar) {
      content.avatar = generateAvatar(content.address)
    }
    return super.create(ipfs, id, content)
  }
}

module.exports = {
  Entry,
  AboutEntry,
  FeedEntry,
  TrackEntry,
  ContactEntry
}
