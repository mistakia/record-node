const path = require('path')

const CACHE_VERSION = 1
const defaultIndex = () => ({
  track: new Map()
})

class ListensIndex {
  constructor ({ oplog, cache, events }) {
    this._oplog = oplog
    this._cache = cache
    this._index = defaultIndex()
    this._cacheIndexKey = path.join(oplog._id, `_listensStoreIndex:${CACHE_VERSION}`)
  }

  _importIndex (str) {
    const idx = JSON.parse(str)
    this._index = {
      track: new Map(idx.track)
    }
  }

  _exportIndex () {
    const tmp = {
      track: Array.from(this._index.track.entries())
    }
    return JSON.stringify(tmp)
  }

  getCount (trackId) {
    const value = this._index.track.get(trackId)
    const count = Object.keys(value).length
    const timestamps = Object.values(value)
    return {
      trackId,
      count,
      timestamps
    }
  }

  add (entry) {
    const { trackId, timestamp } = entry.payload
    const haveIndex = this._index.track.has(trackId)
    const defaultValue = haveIndex ? this._index.track.get(trackId) : {}
    const value = Object.assign(defaultValue, { [entry.hash]: timestamp })
    this._index.track.set(trackId, value)
  }

  async build () {
    const hashes = this._index.track.values().map(i => Object.keys(i)).flat()
    // Find hashes not in Index
    for (const entryHash of Array.from(this._oplog._hashIndex.keys())) {
      if (hashes.includes(entryHash)) {
        continue
      }

      const entry = await this._oplog.get(entryHash)
      this.add(entry)
    }
  }

  async save () {
    await this._cache.set(this._cacheIndexKey, this._exportIndex())
  }

  async loadIndex (oplog) {
    this._oplog = oplog
    const indexCache = await this._cache.get(this._cacheIndexKey)
    if (indexCache) this._importIndex(indexCache)
  }

  async updateIndex (oplog, entry) {
    const hashes = Array.from(this._index.track.values()).map(i => Object.keys(i)).flat()
    if (!hashes.includes(entry.hash)) {
      this.add(entry)
      await this.save()
    }
  }
}

module.exports = ListensIndex
