const { TrackEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      const { start, end } = opts

      const entryHashes = Array
        .from(self._index._index.track.values())
        .reverse()
        .slice(start, end)
        .map(e => e.hash)

      let entries = []
      for (const entryHash of entryHashes) {
        const entry = await self._oplog.get(entryHash)
        entries.push(entry)
      }
      return entries
    },

    findOrCreate: async function (data) {
      const entry = await new TrackEntry().create(data)
      let track = await self.get(entry._id, 'track')

      if (track) {
        return track
      }

      await this.add(data)
      track = await self.get(entry._id, 'track')
      return track
    },

    add: async (data) => {
      const entry = await new TrackEntry().create(data)
      const hash = await self.put(entry)
      return hash
    },

    get: async (id) => {
      const data = self.get(id, 'track')
      return data
    },

    del: (id) => {
      const hash = self.del(id, 'track')
      return hash
    },

    crate: () => {
      // TODO:
    }
  }
}
