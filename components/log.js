const extend = require('deep-extend')
const { sha256 } = require('crypto-hash')
const { CID } = require('ipfs')

const { throttle } = require('../utils')
const { RecordStore } = require('../store')

const logNameRe = /^[0-9a-zA-Z-]*$/

module.exports = function log (self) {
  return {
    _init: async (address = 'record') => {
      const opts = extend({}, self._options.store, { create: true, replicate: true })
      self._log = await self._orbitdb.open(address, opts)
      // TODO
      // await self._ipfs.pin.add(self._log.address.root)

      const { accessControllerAddress } = self._log.options
      // TODO
      // await self.pinAC(accessControllerAddress)

      await self._log.load()

      // TODO - setup all logs I have write access to
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

    _registerEvents: async (log) => {
      const logId = log.id
      const contactId = await sha256(logId)

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

      log.events.on('indexUpdated', (processingCount, entry) => {
        self.emit('redux', {
          type: 'CONTACT_INDEX_UPDATED',
          payload: {
            logId,
            entry,
            isProcessingIndex: log._index.isProcessing,
            processingCount,
            trackCount: log._index.trackCount,
            contactCount: log._index.contactCount
          }
        })
      })

      log.events.on('replicated', (logId) => {
        self.emit('redux', {
          type: 'CONTACT_REPLICATED',
          payload: { contactId, logId, replicationStatus: log.replicationStatus, replicationStats: log._replicator._stats, length: log._oplog._hashIndex.size }
        })
      })

      const onReplicateProgress = (logId, hash, entry) => {
        self.emit('redux', {
          type: 'CONTACT_REPLICATE_PROGRESS',
          payload: { contactId, logId, hash, entry, replicationStatus: log.replicationStatus, replicationStats: log._replicator._stats, length: log._oplog._hashIndex.size }
        })
      }

      const throttledReplicateProgress = throttle(onReplicateProgress, 1500)
      log.events.on('replicate.progress', async (logId, hash, entry, progress, total) => {
        self.logger(`new entry ${logId}/${entry.hash}`)
        throttledReplicateProgress(logId, hash, entry)

        // TODO
        /* const shouldPin = await log.contacts.hasLogId(logId)
         * if (shouldPin) {
         *   await self._ipfs.pin.add(hash, { recursive: false })
         *   await self._ipfs.pin.add(entry.payload.value.content, { recursive: false })
         * } */
      })
    },

    drop: async function (logId) {
      if (!logId) {
        throw new Error('missing logId')
      }

      if (self.isMe(logId)) {
        throw new Error('Cannot drop default log')
      }

      // TODO: remove all exclusive pins

      const log = await this.get(logId)
      if (log._type === RecordStore.type) {
        log._cache.del(log._index._cacheIndexKey)
        log._cache.del(log._index._cacheSearchIndexKey)

        delete self._logs[logId]
      }
      await log.drop(logId)

      return { logId }
    },

    haveAccessController: async function (accessControllerAddress) {
      const hash = accessControllerAddress.split('/')[2]
      const hasAC = await self._ipfs.repo.has(new CID(hash))
      if (!hasAC) {
        return false
      }

      const ipfsAC = await self._ipfs.dag.get(new CID(hash))
      const hasIPFSAC = await self._ipfs.repo.has(new CID(ipfsAC.value.params.address))
      if (!hasIPFSAC) {
        return false
      }

      return true
    },

    get: async function (logId = self.address, options = {}) {
      if (self.isMe(logId)) {
        return self._log
      }

      if (self.listens.isMe(logId)) {
        return self._listensLog
      }

      if (!self.isValidAddress(logId)) {
        if (!options.create) {
          const addr = await self._orbitdb.determineAddress(logId, RecordStore.type)
          logId = addr.toString()
          options.localOnly = true
        } else if (!logNameRe.test(logId)) {
          throw new Error(`${logId} is not a valid log name`)
        }
      }

      if (this.isOpen(logId)) {
        return self._orbitdb.stores[logId]
      }

      const opts = extend({ replicate: false }, self._options.store, options)
      self.logger(`Loading log: ${logId}`, opts)
      const log = await self._orbitdb.open(logId, opts)

      // TODO
      /* await self._ipfs.pin.add(log.address.root)
       * const { accessControllerAddress } = log.options
       * await self.pinAC(accessControllerAddress)
       */
      await this._registerEvents(log)
      await log.load()

      if (log._type === RecordStore.type) {
        self._logs[logId] = log.options.accessControllerAddress
        const contact = await self.contacts.get({ logId, contactAddress: logId })
        self.emit('redux', {
          type: 'CONTACT_LOADED',
          payload: { contact }
        })
      }

      return log
    }
  }
}
