const { TrackEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      const { start, limit } = opts
      const tags = opts.tags && !Array.isArray(opts.tags) ? [opts.tags] : (opts.tags || [])

      if (tags.length && !tags.some(t => self._index.hasTag(t))) {
        return []
      }

      const indexEntries = Array
        .from(self._index._index.track.values())
        .reverse()
        .slice(start, limit)

      let entryHashes = []

      if (tags.length) {
        let i = 0
        while (entryHashes.length < (limit || Infinity) && indexEntries[i]) {
          if (tags.every(t => indexEntries[i].tags.includes(t))) {
            entryHashes.push(indexEntries[i].hash)
          }
          i++
        }
      } else {
        entryHashes = indexEntries.map(e => e.hash)
      }

      let entries = []
      for (const entryHash of entryHashes) {
        const entry = await self.tracks.getFromHash(entryHash)
        entries.push(entry)
      }

      return entries
    },

    has: (id) => {
      return !!self._index.getEntryHash(id, 'track')
    },

    findOrCreate: async function (content) {
      const entry = await new TrackEntry().create(self._ipfs, content)
      let track = await self.get(entry._id, 'track')

      if (!track) {
        return this._add(entry)
      }

      if (!entry.content.equals(track.payload.value.content)) {
        return this._add(entry)
      }

      return self.tracks._loadContent(track)
    },

    _add: async (entry) => {
      await self.put(entry)
      return self.tracks.getFromId(entry._id)
    },

    add: async (content, tags) => {
      const entry = await new TrackEntry().create(self._ipfs, content, tags)
      return self.tracks._add(entry)
    },

    _loadContent: async (entry) => {
      const dagNode = await self._ipfs.dag.get(entry.payload.value.content)
      entry.payload.value.content = dagNode.value
      entry.payload.value.contentCID = dagNode.cid.toString()

      const { content } = entry.payload.value
      entry.payload.value.content.hash = content.hash.toString()
      entry.payload.value.content.artwork = content.artwork.map(a => a.toString())
      return entry
    },

    getFromId: async (id) => {
      const entry = await self.get(id, 'track')
      return self.tracks._loadContent(entry)
    },

    getFromHash: async (hash) => {
      const entry = await self._oplog.get(hash)
      return self.tracks._loadContent(entry)
    },

    del: (id) => {
      const hash = self.del(id, 'track')
      return hash
    }
  }
}
