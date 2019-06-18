const extend = require('deep-extend')

module.exports = function log (self) {
  return {
    _init: async (address = self._options.address) => {
      const opts = extend({}, self._options.store, { create: true, replicate: true })
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
        const openLog = self._orbitdb.stores[logId]
        if (!options.replicate || (options.replicate === openLog.options.replicate)) {
          return openLog
        }
      }

      const opts = extend({}, self._options.store, options)
      self.logger(`Loading log: ${logId}`, opts)
      const log = await self._orbitdb.open(logId, opts)
      await log.load()
      return log
    }
  }
}
