const { sha256 } = require('crypto-hash')

const { LogEntry } = require('../RecordEntry')
const { loadEntryContent } = require('../../utils')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      const { start, end } = opts
      const entryHashes = Array
        .from(self._index._index.log.values())
        .reverse()
        .slice(start, end)
        .map(e => e.hash)

      const entries = []
      for (const entryHash of entryHashes) {
        const entry = await self.logs.getFromHash(entryHash)
        entries.push(entry)
      }
      return entries
    },

    findOrCreate: async function (data, { pin = false } = {}) {
      const entry = await new LogEntry().create(self._ipfs, data, { pin })
      const linkedLog = await self.get(entry.id, 'log')

      if (!linkedLog) {
        return this._add(entry, { pin })
      }

      const contentCID = linkedLog.payload.value.cid || linkedLog.payload.value.content
      if (!entry.content.equals(contentCID)) {
        return this._add(entry, { pin })
      }

      return loadEntryContent(self._ipfs, linkedLog)
    },

    _add: async (entry, { pin = false } = {}) => {
      await self.put(entry, { pin })
      return self.logs.getFromId(entry.id)
    },

    add: async (data, { pin = false } = {}) => {
      const entry = await new LogEntry().create(self._ipfs, data, { pin })
      return this._add(entry, { pin })
    },

    getFromAddress: async (logAddress) => {
      const id = await sha256(logAddress)
      return self.logs.getFromId(id)
    },

    getFromId: async (id) => {
      const entry = await self.get(id, 'log')
      return loadEntryContent(self._ipfs, entry)
    },

    getFromHash: async (hash) => {
      const entry = await self._oplog.get(hash)
      return loadEntryContent(self._ipfs, entry)
    },

    hasId: (id) => {
      return !!self._index.getEntryHash(id, 'log')
    },

    hasAddress: async (logAddress) => {
      const id = await sha256(logAddress)
      return self.logs.hasId(id)
    },

    del: async (id, options) => self.del(id, 'log', options)
  }
}
