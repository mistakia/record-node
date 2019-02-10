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

      let entryCIDs = []

      if (tags.length) {
        let i = 0
        while (entryCIDs.length < (limit || Infinity) && indexEntries[i]) {
          if (tags.every(t => indexEntries[i].tags.includes(t))) {
            entryCIDs.push(indexEntries[i].cid)
          }
          i++
        }
      } else {
        entryCIDs = indexEntries.map(e => e.cid)
      }

      let entries = []
      for (const entryCID of entryCIDs) {
        const entry = await self._oplog.get(entryCID)
        entries.push(entry)
      }
      return entries
    },

    has: (id) => {
      return !!self._index.getEntryCID(id, 'track')
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
      const cid = self.del(id, 'track')
      return cid
    }
  }
}
