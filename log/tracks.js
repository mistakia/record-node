const TrackEntry = require('./TrackEntry')

module.exports = function (self) {
  function filterEntries (mapper) {
    return (doc) => {
      if (doc.type !== 'track') { return false }

      return mapper ? mapper(doc) : true
    }
  }

  return {
    all: (mapper) => {
      const all = self._log.query(filterEntries(mapper))
      return all
    },

    findOrCreate: async function (data) {
      const entry = await new TrackEntry().create(data)
      let track = this.get(entry._id)

      if (track.length) { return track }

      const hash = await this.add(data)
      track = this.get(entry._id)
      return track
    },

    add: async (data) => {
      const entry = await new TrackEntry().create(data)
      const hash = await self._log.put(entry)
      return hash
    },

    get: (key) => {
      const data = self._log.get(key)
      return data
    },

    del: async (key) => {
      const hash = await self._log.del(key)
      return hash
    },

    crate: () => {
      return this.all((doc) => doc.content.crate === true)
    }
  }
}
