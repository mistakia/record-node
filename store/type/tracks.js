const { TrackEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      const { start, limit, tag } = opts

      if (tag && !this._index.hasTag(tag)) {
        return []
      }

      const indexValues = Array
        .from(self._index._index.track.values())
        .reverse()
        .slice(start, limit)

      let entryHashes = []

      if (tag) {
        let i = 0
        while (entryHashes.length < (limit || Infinity)) {
          if (indexEntries[i].tags.indexOf(tag) >= 0) {
            entryHashes.push(indexEntries[i].hash)
          }
        }
      } else {
        entryHashes = indexValues.map(e => e.hash)
      }

      let entries = []
      for (const entryHash of entryHashes) {
        const entry = await self._oplog.get(entryHash)
        entries.push(entry)
      }
      return entries
    },

    has: (id) => {
      return !!self._index.getEntryHash(id, 'track')
    },

    findOrCreate: async function (data) {
      const entry = await new TrackEntry().create(data)
      let track = await self.get(entry._id, 'track')

      if (track) {
        return track
      }

      return this.add(data)
    },

    add: async (data) => {
      const entry = await new TrackEntry().create(data)
      await self.put(entry)
      return self.get(entry._id, 'track')
    },

    // async
    get: (id) => {
      return self.get(id, 'track')
    },

    del: (id) => {
      const hash = self.del(id, 'track')
      return hash
    }
  }
}
