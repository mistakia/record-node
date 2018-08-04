const extend = require('deep-extend')

const { RecordStore } = require('../store')

const defaultConfig = {
  type: RecordStore.type,
  referenceCount: 24,
  replicationConcurrency: 128,
  localOnly: false,
  create: true,
  overwrite: true,
  replicate: false
}

module.exports = function log (self) {
  return {
    init: async (address = 'record') => {
      const opts = extend(defaultConfig, { replicate: true })
      self._log = await self._orbitdb.open(address, opts)
      self._log.events.on('contact', self.contacts.sync)
      await self._log.load()
    },

    get: async (logId, options = {}, load) => {
      if (!logId || logId === '/me' || logId === '/') {
        return self._log
      }

      if (logId === '/feed') {
        return self._feedLog
      }

      if (logId === '/listens') {
        return self._listensLog
      }

      if (!self.isValidAddress(logId)) {
        throw new Error(`${logId} is not a valid OrbitDB address`)
      }

      const defaults = extend(defaultConfig, { create: false })
      const opts = extend(defaults, options)
      const log = await self._orbitdb.open(logId, opts)

      self.logger(`Loading log: ${log.address}`)
      await log.load()

      return log
    }
  }
}
