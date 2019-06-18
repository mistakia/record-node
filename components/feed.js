const { RecordFeedStore } = require('../store')
const extend = require('deep-extend')

module.exports = function feed (self) {
  return {
    _init: async () => {
      const opts = {
        create: true,
        replicate: false,
        type: RecordFeedStore.type
      }
      self._feedLog = await self._orbitdb.open('feed', opts)
      await self._feedLog.load()
    },

    get address () {
      return self._feedLog.address.toString()
    },

    isMe: (logId) => {
      return self._feedLog.address.toString() === logId
    },

    add: async (entry, contact) => {
      await self._feedLog.add(entry, contact) // TODO
    },

    list: async (opts) => {
      const feedEntries = await self._feedLog.query(opts)
      let entries = []
      for (const feedEntry of feedEntries) {
        const { entryType, logId, entryId } = feedEntry.payload
        const contact = await self.contacts.get({ logId: self.address, contactAddress: logId })
        const entry = await self[`${entryType}s`].get(logId, entryId)
        entries.push(extend(feedEntry.payload, { contact }, { content: entry }))
      }
      return entries
    }
  }
}
