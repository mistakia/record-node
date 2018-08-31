const extend = require('deep-extend')

const { RecordStore } = require('../store')

const defaultConfig = {
  type: RecordStore.type,
  referenceCount: 24,
  replicationConcurrency: 128,
  localOnly: false,
  create: false,
  overwrite: true,
  replicate: false
}

module.exports = function log (self) {
  return {
    init: async (address = 'record') => {
      const opts = extend({}, defaultConfig, { create: true, replicate: true })
      self._log = await self._orbitdb.open(address, opts)
      await self._log.load()
    },

    mine: () => {
      return self._log
    },

    isMine: (log) => {
      return self._log.address === log.address
    },

    isOpen: (logId) => {
      return !!self._orbitdb.stores[logId]
    },

    get: async function (logId = self.address, options = {}, load) {
      if (self.isMe(logId)) {
        return self._log
      }

      if (self.feed.isMe(logId)) {
        return self._feedLog
      }

      if (self.listens.isMe(logId)) {
        return self._listensLog
      }

      if (!self.isValidAddress(logId)) {
        throw new Error(`${logId} is not a valid OrbitDB address`)
      }

      if (this.isOpen(logId)) {
        return self._orbitdb.stores[logId]
      }

      const opts = extend({}, defaultConfig, options)
      self.logger(opts)
      const log = await self._orbitdb.open(logId, opts)

      self.logger(`Loading log: ${log.address}`)
      await log.load()

      return log
    }
  }
}
