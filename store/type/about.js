const { AboutEntry } = require('../RecordEntry')
const { loadEntryContent } = require('../../utils')

module.exports = function (self) {
  return {
    put: async function (data) {
      data.address = self.address.toString()
      const recordEntry = await new AboutEntry().create(self._ipfs, data)
      const logEntry = await self.put(recordEntry)
      return loadEntryContent(self._ipfs, logEntry)
    }
  }
}
