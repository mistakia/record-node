const { RecordFeedStore } = require('../store')

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

    isMe: (logId) => {
      if (logId === '/feed') {
        return true
      }

      return self._feedLog.address.toString() === logId
    },

    add: async (entry, contact) => {
      await self._feedLog.add(entry, contact)
    },

    list: async (opts) => {
      const feedEntries = await self._feedLog.query(opts)
      let entries = []
      for (const feedEntry of feedEntries) {
        const contact = await self.contacts.get('/me', feedEntry.payload.contactId)
        const { address } = contact.content
        const { type } = feedEntry.payload
        // TODO: make this readable and less suspect :(
        const entry = await self[`${type}s`].get(address, feedEntry.payload.entryId)
        entries.push({
          ...feedEntry.payload,
          contact: contact,
          content: entry
        })
      }
      return entries
    }
  }
}
