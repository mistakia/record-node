const { sha256 } = require('crypto-hash')

const { LogEntry } = require('../RecordEntry')
const { loadEntryContent } = require('../utils')

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

    findOrCreate: async function (data, shouldPin) {
      const entry = await new LogEntry().create(self._ipfs, data, shouldPin)
      const linkedLog = await self.get(entry.id, 'log')

      if (!linkedLog) {
        return this._add(entry, shouldPin)
      }

      const contentCID = linkedLog.payload.value.cid || linkedLog.payload.value.content
      if (!entry.content.equals(contentCID)) {
        return this._add(entry, shouldPin)
      }

      return loadEntryContent(self._ipfs, linkedLog)
    },

    _add: async (entry, shouldPin) => {
      await self.put(entry)
      // TODO - renable pinning
      // if (shouldPin) await self._ipfs.pin.add(hash)
      return self.logs.getFromId(entry.id)
    },

    add: async (data, shouldPin) => {
      const entry = await new LogEntry().create(self._ipfs, data, shouldPin)
      return this._add(entry, shouldPin)
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

    del: (id) => {
      const hash = self.del(id, 'log')
      return hash
    }
  }
}
