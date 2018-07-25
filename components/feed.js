const extend = require('deep-extend')

const { RecordFeedStore } = require('../store')

module.exports = function feed (self) {
  return {
    init: async () => {
      const opts = extend(self._options.storeConfig, {
        create: true,
        replicate: true,
        type: RecordFeedStore.type
      })
      self._feedLog = await self._orbitdb.open('feed', opts)
      await self._feedLog.load()
    },

    add: async (entry) => {
      await self._feedLog.add({
        id: entry.id,
        entryId: entry.payload.key
      })
    },

    list: async (start = null, limit = 20) => {
      const entries = await self._feedLog.query({ start, limit })
      return entries
    }
  }
}
