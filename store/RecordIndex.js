const Log = require('ipfs-log')

class RecordIndex {
  constructor (id, initialTrack = null, initialContact = null, cache) {
    this._index = {
      tags: {},
      track: new Map(initialTrack),
      contact: new Map(initialContact)
    }
    this._cache = cache
  }

  hasTag (tag) {
    return this._index.tags.hasOwnProperty(tag)
  }

  getEntry (id, type) {
    return this._index[type].get(id)
  }

  getEntryHash (id, type) {
    const entry = this.getEntry(id, type)
    return entry ? entry.hash : null
  }

  async updateIndex (oplog, onProgressCallback) {
    const reducer = (handled, item, idx) => {
      const { key } = item.payload

      if (handled[key] !== true) {
        handled[key] = true

        const { type } = item.payload.value
        const entry = this.getEntry(key, type)

        if (entry && entry.clock.time > item.clock.time) {
          return handled
        }

        if (item.payload.op === 'PUT') {

          let cache = {
            hash: item.hash,
            clock: item.clock
          }

          if (type === 'track') {
            cache.tags = item.payload.value.content.tags
          }

          this._index[type].set(key, cache)
        } else if (item.payload.op === 'DEL') {
          this._index[type].delete(key)
        }
      }
      if (onProgressCallback) onProgressCallback(item, idx)
      return handled
    }

    // Get all hashes in Index
    const trackHashes = Array.from(this._index.track.values()).map(e => e.hash)
    const contactHashes = Array.from(this._index.contact.values()).map(e => e.hash)
    const entryHashes = [].concat(trackHashes, contactHashes)

    // Get hashes from oplog not in Index
    let values = []
    for (const [entryHash] of oplog._nextsIndex) {
      if (!entryHashes.includes(entryHash)) {
        const entry = await oplog.get(entryHash)
        values.push(entry)
      }
    }

    // Reverse new hashes and add to Index
    values.sort(Log.Entry.compare).reverse().reduce(reducer, {})

    // Build tags Index
    this._index.tags = {}
    for (const track of this._index.track.values()) {
      track.tags && track.tags.forEach(t => this._index.tags[t] = (this._index.tags[t]+1) || 1)
    }

    // Re-sort Index
    this._index.track = new Map([...this._index.track.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))
    this._index.contact = new Map([...this._index.contact.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))

    // Cache Index
    this._cache.set('_indexTrack', Array.from(this._index.track.entries()))
    this._cache.set('_indexContact', Array.from(this._index.contact.entries()))
  }
}

module.exports = RecordIndex
