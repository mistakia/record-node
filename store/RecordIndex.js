const Log = require('ipfs-log')

class RecordIndex {
  constructor (id) {
    this._index = {
      tags: {},
      about: null,
      track: new Map(),
      contact: new Map()
    }
  }

  hasTag (tag) {
    return this._index.tags.hasOwnProperty(tag)
  }

  has (id, type) {
    return !!this.getEntry(id, type)
  }

  getEntry (id, type) {
    if (type === 'about') {
      return this._index.about
    }

    return this._index[type].get(id)
  }

  getEntryCID (id, type) {
    const entry = this.getEntry(id, type)
    return entry ? entry.cid : null
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
          if (type === 'about') {
            this._index.about = item
            return handled
          }

          let cache = {
            cid: item.cid,
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

    // Get all CIDs in Index
    const trackCIDs = Array.from(this._index.track.values()).map(e => e.cid)
    const contactCIDs = Array.from(this._index.contact.values()).map(e => e.cid)
    const entryCIDs = [].concat(trackCIDs, contactCIDs)

    // Get CIDs from oplog not in Index
    let values = []
    for (const [entryCID] of oplog._cidIndex) {
      if (!entryCIDs.includes(entryCID)) {
        const entry = await oplog.get(entryCID)
        values.push(entry)
      }
    }

    // Reverse new CIDs and add to Index
    values.sort(Log.Entry.compare).reverse().reduce(reducer, {})

    // Build tags Index
    this._index.tags = {}
    for (const track of this._index.track.values()) {
      track.tags && track.tags.forEach(t => { this._index.tags[t] = (this._index.tags[t] + 1) || 1 })
    }

    // Re-sort Index
    this._index.track = new Map([...this._index.track.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))
    this._index.contact = new Map([...this._index.contact.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))
  }
}

module.exports = RecordIndex
