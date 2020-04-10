const path = require('path')
const Log = require('ipfs-log')
const FlexSearch = require('flexsearch')
const { default: PQueue } = require('p-queue')
const { CID } = require('ipfs')

const { throttle } = require('../utils')
const { loadEntryContent } = require('./utils')

const defaultIndex = () => ({
  tags: {},
  about: null,
  track: new Map(),
  contact: new Map()
})

const CACHE_VERSION = 1
const indexManager = new PQueue({ concurrency: 100, timeout: 30000 })

class RecordIndex {
  constructor ({ oplog, cache, events }) {
    this._cacheIndexKey = path.join(oplog._id, `_recordStoreIndex:${CACHE_VERSION}`)
    this._cacheSearchIndexKey = path.join(oplog._id, `_recordStoreSearchIndex:${CACHE_VERSION}`)

    this._indexQueue = {}
    this._oplog = oplog
    this._cache = cache
    this._events = events
    this._index = defaultIndex()
    this._isBuilding = false
    this._searchIndex = new FlexSearch('balance', {
      async: true,
      cache: 100,
      doc: {
        id: 'key',
        field: [
          'title',
          'artist',
          'album',
          'resolver'
        ],
        tag: ['tags']
      }
    })

    this._emitProcessedThrottled = throttle(async () => {
      await this.save()
      this._events.emit('processed')
    }, 5000)
    this._emitProcessingThrottled = throttle(() => {
      this._events.emit('processing', this.indexQueueSize)
    }, 2500)
  }

  get isBuilding () {
    return this._isBuilding
  }

  get indexQueueSize () {
    return Object.keys(this._indexQueue).length
  }

  get isProcessing () {
    return !!this.indexQueueSize
  }

  get trackCount () {
    return this._index.track.size
  }

  get contactCount () {
    return this._index.contact.size
  }

  async rebuild () {
    this._index = defaultIndex()
    this._searchIndex.clear()

    await this.build()
  }

  async build () {
    this._isBuilding = true

    // Get all Hashes in Index
    const trackHashes = Array.from(this._index.track.values()).map(e => e.hash)
    const contactHashes = Array.from(this._index.contact.values()).map(e => e.hash)
    const queueHashes = Object.keys(this._indexQueue)
    const entryHashes = [].concat(trackHashes, contactHashes, queueHashes)

    // Find hashes not in Index
    for (const entryHash of Array.from(this._oplog._hashIndex.keys()).reverse()) {
      if (entryHashes.includes(entryHash)) {
        continue
      }

      const entry = await this._oplog.get(entryHash)
      const { key } = entry.payload
      const { type } = entry.payload.value
      const cache = this.getEntry(key, type)
      if (cache && cache.clock.time > entry.clock.time) {
        continue
      }

      // Check to see if entry contents are local, add to indexManager if not
      if (CID.isCID(entry.payload.value.content)) {
        const haveLocally = await this._oplog._storage.repo.has(entry.payload.value.content)
        if (!haveLocally) {
          this.process(entry)
          continue
        }
      }

      const loadedEntry = await loadEntryContent(this._oplog._storage, entry)
      this.add(loadedEntry)
    }

    this.updateTags()
    this.sort()

    await this.save()
    this._isBuilding = false
  }

  async save () {
    await this._cache.set(this._cacheIndexKey, this._exportIndex())
    await this._cache.set(this._cacheSearchIndexKey, this._searchIndex.export())
  }

  _exportIndex () {
    const tmp = {
      track: Array.from(this._index.track.entries()),
      contact: Array.from(this._index.contact.entries()),
      tags: this._index.tags,
      about: this._index.about
    }
    return JSON.stringify(tmp)
  }

  _importIndex (str) {
    const idx = JSON.parse(str)
    this._index = {
      tags: idx.tags,
      about: idx.about,
      track: new Map(idx.track),
      contact: new Map(idx.contact)
    }
  }

  async process (entry) {
    this._indexQueue[entry.hash] = true

    await indexManager.add(async () => {
      try {
        this._emitProcessingThrottled()

        const loadedEntry = await loadEntryContent(this._oplog._storage, entry)

        this.add(loadedEntry)
        this.updateTags()
        this.sort()

        if (!this.isProcessing) {
          this._emitProcessedThrottled()
        }
      } catch (error) {
        console.log(error)
      }
    })
    delete this._indexQueue[entry.hash]
  }

  hasTag (tag) {
    return {}.hasOwnProperty.call(this._index.tags, tag)
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

  getEntryHash (id, type) {
    const entry = this.getEntry(id, type)
    return entry ? entry.hash : null
  }

  add (item) {
    const { key } = item.payload
    const { type } = item.payload.value
    const entry = this.getEntry(key, type)

    if (entry && entry.clock.time > item.clock.time) {
      return
    }

    if (item.payload.op === 'PUT') {
      if (type === 'about') {
        this._index.about = item
        return
      }

      const cache = {
        hash: item.hash,
        clock: item.clock
      }

      if (type === 'track') {
        cache.tags = item.payload.value.tags
        const { resolver } = item.payload.value.content
        cache.resolver = resolver.map(r => `${r.extractor}:${r.id}`)
        const { title, artist, album } = item.payload.value.content.tags
        this._searchIndex.add({
          key,
          resolver: resolver.map(r => r.fulltitle).join(' '),
          tags: item.payload.value.tags,
          title,
          artist,
          album
        })
      }
      this._index[type].set(key, cache)
    } else if (item.payload.op === 'DEL') {
      this._searchIndex.remove(key)
      this._index[type].delete(key)
    }

    this._events.emit('indexUpdated', this.indexQueueSize, item)
  }

  updateTags () {
    this._index.tags = {}
    for (const track of this._index.track.values()) {
      track.tags && track.tags.forEach(t => { this._index.tags[t] = (this._index.tags[t] + 1) || 1 })
    }
  }

  sort () {
    this._index.track = new Map([...this._index.track.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))
    this._index.contact = new Map([...this._index.contact.entries()].sort((a, b) => Log.Entry.compare(a[1], b[1])))
  }

  async loadIndex (oplog) {
    this._oplog = oplog
    const indexCache = await this._cache.get(this._cacheIndexKey)
    if (indexCache) this._importIndex(indexCache)

    const searchIndexCache = await this._cache.get(this._cacheSearchIndexKey)
    if (searchIndexCache) this._searchIndex.import(searchIndexCache)

    await this.build()
  }

  async updateIndex (oplog, entry) {
    // Get all Hashes in Index + Queue
    const trackHashes = Array.from(this._index.track.values()).map(e => e.hash)
    const contactHashes = Array.from(this._index.contact.values()).map(e => e.hash)
    const queueHashes = Object.keys(this._indexQueue)
    const entryHashes = [].concat(trackHashes, contactHashes, queueHashes)

    // make sure entry is not in index before adding
    if (!entryHashes.includes(entry.hash)) {

      const loadedEntry = await loadEntryContent(this._oplog._storage, entry)
      this.add(loadedEntry)

      // Build tags Index
      this.updateTags()

      // Re-sort Index
      this.sort()

      // Save to disk
      await this.save()
    }
  }
}

module.exports = RecordIndex
