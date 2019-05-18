const { ContactEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      const { start, limit } = opts
      const entryHashes = Array
        .from(self._index._index.contact.values())
        .reverse()
        .slice(start, limit)
        .map(e => e.hash)

      let entries = []
      for (const entryHash of entryHashes) {
        const entry = await self._oplog.get(entryHash)
        entries.push(entry)
      }
      return entries
    },

    findOrCreate: async function (data) {
      const entry = await new ContactEntry().create(data)
      let contact = await self.get(entry._id, 'contact')

      if (contact) {
        return contact
      }

      await this.add(data)
      contact = await self.get(entry._id, 'contact')
      return contact
    },

    add: async (data) => {
      const entry = await new ContactEntry().create(data)
      const hash = await self.put(entry)
      return hash
    },

    get: async (id) => {
      const data = await self.get(id, 'contact')
      return data
    },

    has: (id) => {
      return !!self._index.getEntryHash(id, 'contact')
    },

    del: (id) => {
      const hash = self.del(id, 'contact')
      return hash
    }
  }
}
