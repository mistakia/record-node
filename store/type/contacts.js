const { ContactEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      const { start, end } = opts
      const entryHashes = Array
        .from(self._index._index.contact.values())
        .reverse()
        .slice(start, end)
        .map(e => e.hash)

      let entries = []
      for (const entryHash of entryHashes) {
        const entry = await self.contacts.getFromHash(entryHash)
        entries.push(entry)
      }
      return entries
    },

    findOrCreate: async function (data) {
      const entry = await new ContactEntry().create(self._ipfs, data)
      let contact = await self.get(entry.id, 'contact')

      if (!contact) {
        return this._add(entry)
      }

      if (!entry.content.equals(contact.payload.value.content)) {
        return this._add(entry)
      }

      return this._loadContent(contact)
    },

    _add: async (entry) => {
      await self.put(entry)
      return self.contacts.getFromId(entry.id)
    },

    add: async (data) => {
      const entry = await new ContactEntry().create(self._ipfs, data)
      const hash = await self.put(entry)
      return hash
    },

    _loadContent: async (entry) => {
      if (!entry) {
        return null
      }

      entry.payload.value.contentCID = entry.payload.value.content.toBaseEncodedString('base58btc')
      const dagNode = await self._ipfs.dag.get(entry.payload.value.content, { localResolve: true })
      entry.payload.value.content = dagNode.value
      return entry
    },

    getFromId: async (id) => {
      const entry = await self.get(id, 'contact')
      return self.contacts._loadContent(entry)
    },

    getFromHash: async (hash) => {
      const entry = await self._oplog.get(hash)
      return self.contacts._loadContent(entry)
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
