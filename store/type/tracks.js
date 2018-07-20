const mapSeries = require('p-map-series')

const { TrackEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (startIndex, endIndex) => {
      const entryHashes = Array.from(self._index._index.track.values())
                               .reverse()
                               .slice(startIndex, endIndex)
                               .map(e => e.hash)

      const entries = await mapSeries(entryHashes, self._oplog.get.bind(self._oplog))
      return entries
    },

    findOrCreate: async function (data) {
      const entry = await new TrackEntry().create(data)
      let track = await self.get(entry._id, 'track')

      if (track) {
        return track
      }

      const hash = await this.add(data)
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
      //TODO:
    }
  }
}
