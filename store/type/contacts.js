const { sha256 } = require('crypto-hash')

const { ContactEntry } = require('../RecordEntry')
const { loadEntryContent } = require('../utils')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      const { start, end } = opts
      const entryHashes = Array
        .from(self._index._index.contact.values())
        .reverse()
        .slice(start, end)
        .map(e => e.hash)

      const entries = []
      for (const entryHash of entryHashes) {
        const entry = await self.contacts.getFromHash(entryHash)
        entries.push(entry)
      }
      return entries
    },

    findOrCreate: async function (data, shouldPin) {
      const entry = await new ContactEntry().create(self._ipfs, data, shouldPin)
      const contact = await self.get(entry.id, 'contact')

      if (!contact) {
        return this._add(entry, shouldPin)
      }

      const contentCID = contact.payload.value.cid || contact.payload.value.content
      if (!entry.content.equals(contentCID)) {
        return this._add(entry, shouldPin)
      }

      return loadEntryContent(self._ipfs, contact)
    },

    _add: async (entry, shouldPin) => {
      const hash = await self.put(entry)
      // TODO
      // if (shouldPin) await self._ipfs.pin.add(hash)
      return self.contacts.getFromId(entry.id)
    },

    add: async (data, shouldPin) => {
      const entry = await new ContactEntry().create(self._ipfs, data, shouldPin)
      return this._add(entry, shouldPin)
    },

    getFromId: async (id) => {
      const entry = await self.get(id, 'contact')
      return loadEntryContent(self._ipfs, entry)
    },

    getFromHash: async (hash) => {
      const entry = await self._oplog.get(hash)
      return loadEntryContent(self._ipfs, entry)
    },

    has: (id) => {
      return !!self._index.getEntryHash(id, 'contact')
    },

    hasLogId: async (logId) => {
      const id = await sha256(logId)
      return self.contacts.has(id)
    },

    del: (id) => {
      const hash = self.del(id, 'contact')
      return hash
    }
  }
}
