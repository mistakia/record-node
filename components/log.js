const extend = require('deep-extend')
const { CID } = require('ipfs')

const { throttle } = require('../utils')
const { RecordStore } = require('../store')

const logNameRe = /^[0-9a-zA-Z-]*$/

module.exports = function log (self) {
  return {
    _init: async (address = 'record') => {
      const opts = extend({}, self._options.store, { create: true, replicate: true })
      self._log = await self._orbitdb.open(address, opts)
      // TODO - re-enable pinning
      // await self._ipfs.pin.add(self._log.address.root)

      const { accessControllerAddress } = self._log.options
      // TODO - re-enable pinning
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

    isOpen: (logAddress) => {
      return !!self._orbitdb.stores[logAddress]
    },

    isEmpty: async (logAddress) => {
      const log = await self.log.get(logAddress, { replicate: false })
      return !(log._oplog._hashIndex.size || log._oplog._length)
    },

    isLocal: async (logAddress) => {
      const address = self.parseAddress(logAddress)
      const haveManifest = self.log.haveManifest(address.root)
      if (!haveManifest) {
        return false
      }

      const { accessController } = await self.log.getManifest(address.root)
      return self.log.haveAccessController(accessController)
    },

    getManifest: async (manifestAddress) => {
      const manifest = await self._ipfs.dag.get(new CID(manifestAddress))
      return manifest.value
    },

    haveManifest: async (manifestAddress) => {
      return self._ipfs.repo.has(new CID(manifestAddress))
    },

    haveAccessController: async (accessControllerAddress) => {
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

    _registerEvents: async (log) => {
      const logAddress = log.id

      log.events.on('peer', (peerId) => {
        self.emit('redux', {
          type: 'LOG_PEER_JOINED',
          payload: { logAddress, peerId }
        })
      })

      log.events.on('processed', () => {
        self.emit('redux', {
          type: 'LOG_INDEX_UPDATED',
          payload: { logAddress, isProcessingIndex: log._index.isProcessing }
        })
      })

      log.events.on('processing', (processingCount) => {
        self.emit('redux', {
          type: 'LOG_INDEX_UPDATED',
          payload: { logAddress, isProcessingIndex: log._index.isProcessing, processingCount }
        })
      })

      let updatedEntries = []
      const onIndexUpdated = (processingCount) => {
        self.emit('redux', {
          type: 'LOG_INDEX_UPDATED',
          payload: {
            logAddress,
            data: updatedEntries,
            isProcessingIndex: log._index.isProcessing,
            processingCount,
            trackCount: log._index.trackCount,
            logCount: log._index.logCount
          }
        })
        updatedEntries = []
      }

      const throttledIndexUpdated = throttle(onIndexUpdated, 2500)
      log.events.on('indexUpdated', (processingCount, entry) => {
        updatedEntries.push(entry)
        throttledIndexUpdated(processingCount)
      })

      log.events.on('replicated', (logAddress) => {
        self.emit('redux', {
          type: 'LOG_REPLICATED',
          payload: { logAddress, replicationStatus: log.replicationStatus, replicationStats: log._replicator._stats, length: log._oplog._hashIndex.size }
        })
      })

      const onReplicateProgress = (logAddress, hash, entry) => {
        self.emit('redux', {
          type: 'LOG_REPLICATE_PROGRESS',
          payload: { logAddress, hash, entry, replicationStatus: log.replicationStatus, replicationStats: log._replicator._stats, length: log._oplog._hashIndex.size }
        })
      }

      const throttledReplicateProgress = throttle(onReplicateProgress, 2000)
      log.events.on('replicate.progress', async (logAddress, hash, entry, progress, total) => {
        self.logger(`new entry ${logAddress}/${entry.hash}`)
        throttledReplicateProgress(logAddress, hash, entry)

        // TODO re-enable pinning
        /* const shouldPin = await log.logs.hasAddress(logAddress)
         * if (shouldPin) {
         *   await self._ipfs.pin.add(hash, { recursive: false })
         *   await self._ipfs.pin.add(entry.payload.value.content, { recursive: false })
         * } */
      })
    },

    drop: async function (logAddress) {
      if (!logAddress) {
        throw new Error('missing logAddress')
      }

      if (self.isMe(logAddress)) {
        throw new Error('Cannot drop default log')
      }

      // TODO: remove all exclusive pins

      const log = await this.get(logAddress)
      if (log._type === RecordStore.type) {
        log._cache.del(log._index._cacheIndexKey)
        log._cache.del(log._index._cacheSearchIndexKey)

        delete self._logAddresses[logAddress]
      }
      await log.drop(logAddress)

      return { logAddress }
    },

    get: async function (logAddress = self.address, options = {}) {
      if (self.isMe(logAddress)) {
        return self._log
      }

      if (self.listens.isMe(logAddress)) {
        return self._listensLog
      }

      if (!self.isValidAddress(logAddress)) {
        if (!options.create) {
          const addr = await self._orbitdb.determineAddress(logAddress, RecordStore.type)
          logAddress = addr.toString()
          options.localOnly = true
        } else if (!logNameRe.test(logAddress)) {
          throw new Error(`${logAddress} is not a valid log name`)
        }
      }

      if (this.isOpen(logAddress)) {
        return self._orbitdb.stores[logAddress]
      }

      const opts = extend({ replicate: false }, self._options.store, options)
      self.logger(`Loading log: ${logAddress}`, opts)
      const log = await self._orbitdb.open(logAddress, opts)

      if (log._type === RecordStore.type) {
        const data = await self.logs.get({ targetAddress: logAddress })
        self.emit('redux', {
          type: 'LOG_LOADING',
          payload: {
            data
          }
        })
      }

      // TODO re-enable pinning
      /* await self._ipfs.pin.add(log.address.root)
       * const { accessControllerAddress } = log.options
       * await self.pinAC(accessControllerAddress)
       */
      await this._registerEvents(log)
      await log.load()

      if (log._type === RecordStore.type) {
        self._logAddresses[logAddress] = log.options.accessControllerAddress
        const data = await self.logs.get({ targetAddress: logAddress })
        self.emit('redux', {
          type: 'LOG_LOADED',
          payload: {
            data
          }
        })
      }

      return log
    }
  }
}
