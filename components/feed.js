const { RecordFeedStore } = require('../store')
const extend = require('deep-extend')

module.exports = function feed (self) {
  return {
    init: async () => {
      const opts = {
        create: true,
        replicate: true,
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
      await self._feedLog.add(entry, contact)
    },

    list: async (opts) => {
      const feedEntries = await self._feedLog.query(opts)
      let entries = []
      for (const feedEntry of feedEntries) {
        const contact = await self.contacts.get(self.address, feedEntry.payload.contactId)
        const { address } = contact.content
        const { type } = feedEntry.payload
        // TODO: make this readable and less suspect :(
        const entry = await self[`${type}s`].get(address, feedEntry.payload.entryId)
        entries.push(extend(feedEntry.payload, { contact }, { content: entry }))
      }
      return entries
    }
  }
}
