const Log = require('ipfs-log')

class RecordIndex {
  constructor (id, initialTrack = null, initialContact = null, cache) {
    this._index = {
      track: new Map(initialTrack),
      contact: new Map(initialContact)
    }
    this._cache = cache
  }

  getEntryHash (id, type) {
    const i = this._index[type].get(id)
    return i ? i.hash : null
  }

  async updateIndex (oplog, onProgressCallback) {
    const reducer = (handled, item, idx) => {
      if (handled[item.payload.key] !== true) {
        handled[item.payload.key] = true
        if(item.payload.op === 'PUT') {
          //TODO: set hash and if crate
          this._index[item.payload.value.type].set(item.payload.key, {
            hash: item.hash,
            clock: item.clock
          })
        } else if (item.payload.op === 'DEL') {
          this._index[item.payload.value.type].delete(item.payload.key)
        }
      }
      if (onProgressCallback) onProgressCallback(item, idx)
      return handled
    }

    const trackHashes = Array.from(this._index.track.values()).map(e => e.hash)
    const contactHashes = Array.from(this._index.contact.values()).map(e => e.hash)
    const entryHashes = [].concat(trackHashes, contactHashes)
    let values = []
    for (const [entryHash, nextHash] of oplog._nextsIndex) {
      if (entryHashes.indexOf(entryHash) < 0) {
        const entry = await oplog.get(entryHash)
        values.push(entry)
      }
    }

    values.sort(Log.Entry.compare).reverse().reduce(reducer, {})

    this._index.track = new Map([...this._index.track.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))
    this._index.contact = new Map([...this._index.contact.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))

    this._cache.set('_indexTrack', Array.from(this._index.track.entries()))
    this._cache.set('_indexContact', Array.from(this._index.contact.entries()))
  }
}

module.exports = RecordIndex
