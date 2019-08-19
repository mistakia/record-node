const extend = require('deep-extend')

module.exports = function log (self) {
  return {
    _init: async (address = 'record') => {
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
        return self._orbitdb.stores[logId]
      }

      const opts = extend({ replicate: false }, self._options.store, options)
      self.logger(`Loading log: ${logId}`, opts)
      const log = await self._orbitdb.open(logId, opts)
      log.events.on('peer', (peerId) => {
        self.emit('redux', {
          type: 'CONTACT_PEER_JOINED',
          payload: { logId, peerId }
        })
      })

      log.events.on('processed', () => {
        self.emit('redux', {
          type: 'CONTACT_INDEX_UPDATED',
          payload: { logId, isProcessingIndex: log._index.isProcessing }
        })
      })

      log.events.on('processing', (processingCount) => {
        self.emit('redux', {
          type: 'CONTACT_INDEX_UPDATED',
          payload: { logId, isProcessingIndex: log._index.isProcessing, processingCount }
        })
      })

      log.events.on('indexUpdated', (processingCount) => {
        self.emit('redux', {
          type: 'CONTACT_INDEX_UPDATED',
          payload: {
            logId,
            isProcessingIndex: log._index.isProcessing,
            processingCount,
            trackCount: log._index.trackCount,
            contactCount: log._index.contactCount
          }
        })
      })

      self.emit('redux', {
        type: 'CONTACT_LOADING',
        payload: { logId }
      })
      await log.load()
      self.emit('redux', {
        type: 'CONTACT_READY',
        payload: { logId }
      })

      if (log._type === 'recordstore') {
        self._logs[logId] = log.options.accessControllerAddress
      }

      return log
    }
  }
}
