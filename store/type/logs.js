const { LogEntry } = require('../RecordEntry')
const { loadEntryContent } = require('../../utils')

module.exports = function (self) {
  return {
    put: async function (data) {
      const recordEntry = await new LogEntry().create(self._ipfs, data)
      const logEntry = await self.put(recordEntry)
      return loadEntryContent(self._ipfs, logEntry)
    },

    del: async (id) => self.del(id, 'log')
  }
}
