const { TrackEntry } = require('../RecordEntry')
const { loadEntryContent } = require('../../utils')

module.exports = function (self) {
  return {
    put: async function (content, tags) {
      const recordEntry = await new TrackEntry().create(self._ipfs, content, { tags })
      const logEntry = await self.put(recordEntry)
      return loadEntryContent(self._ipfs, logEntry)
    },

    del: async (id) => self.del(id, 'track')
  }
}
