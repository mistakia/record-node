const extend = require('deep-extend')
const { CID } = require('ipfs-http-client')

const { throttle } = require('../utils')
const { RecordStore } = require('../store')

const logNameRe = /^[0-9a-zA-Z-]*$/

module.exports = function log (self) {
  return {
    _init: async (address = 'record') => {
      const opts = extend({}, self._options.store, { create: true, replicate: true, pin: true })
      self._log = await self._orbitdb.open(address, opts)
      await self.log.pinAccessController(self._log.options.accessControllerAddress)
      await self._log.load()
    },

    mine: () => {
      return self._log
    },

    getLocalAddresses: async () => {
      const logAddresses = Object.keys(self._logAddresses)
      const localAddresses = []
      for (const logAddress of logAddresses) {
        const isLocal = await self.log.isLocal(logAddress)
        if (isLocal) localAddresses.push(logAddress)
      }
      return localAddresses
    },

    getLocalLogs: async () => {
      const localAddresses = await self.log.getLocalAddresses()
      const logs = []
      for (const logAddress of localAddresses) {
        const log = await self.log.get(logAddress)
        logs.push(log)
      }
      return logs
    },

    canAppend: async (logAddress) => {
      const log = await self.log.get(logAddress, { replicate: false })
      return log.access.write.includes(self.identity)
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

        const isLinked = await log.logs.hasAddress(logAddress)
        if (isLinked) {
          await self._ipfs.pin.add(hash, { recursive: false })
          await self._ipfs.pin.add(entry.payload.value.content, { recursive: false })
        }
      })
    },

    pinAccessController: async (accessControllerAddress) => {
      const acAddress = accessControllerAddress.split('/')[2]
      await self._ipfs.pin.add(acAddress)
      const dagNode = await self._ipfs.dag.get(acAddress)
      await self._ipfs.pin.add(dagNode.value.params.address)
    },

    isInPinnedLogs: async ({ id, type }) => {
      const log = self.log.mine()
      const inLog = !!log._index.getEntryHash(id, type)
      if (inLog) {
        return true
      }

      const entries = await log.logs.all()
      const linkedAddresses = entries.map(e => e.payload.value.content.address)
      for (const linkAddress of linkedAddresses) {
        const linkedLog = await self.log.get(linkAddress)
        const hasContent = !!linkedLog._index.getEntryHash(id, type)

        if (hasContent) {
          return true
        }
      }

      return false
    },

    removePin: async ({ id, hash, type }) => {
      if (type !== 'about') {
        const isInPinnedLogs = await self.log.isInPinnedLogs({ id, type })
        if (isInPinnedLogs) {
          return // exit without unpinning
        }
      }

      self.logger(`Removing pin for ${hash}`)
      await self._ipfs.pin.rm(hash)
    },

    removePins: async function (logAddress) {
      self.logger(`Removing pins for ${logAddress}`)

      const log = await self.log.get(logAddress)
      for (const hash of log._oplog._hashIndex.keys()) {
        const entry = await log._oplog.get(hash)
        const { type, contentCID } = entry.payload.value
        const { key } = entry.payload
        await self.log.removePin({ id: key, hash: contentCID, type })
        await self._ipfs.pin.rm(entry.hash, { recursive: false })
      }
    },

    drop: async function (logAddress) {
      if (!logAddress) {
        throw new Error('missing logAddress')
      }

      if (self.isMe(logAddress)) {
        throw new Error('Cannot drop default log')
      }

      const log = await self.log.get(logAddress)
      if (log._type === RecordStore.type) {
        await self.log.removePins(logAddress)
        log._cache.del(log._index._cacheIndexKey)
        log._cache.del(log._index._cacheSearchIndexKey)
        delete self._logAddresses[logAddress]
      }

      try {
        await self._ipfs.pin.rm(log.address.root)

        const acAddress = log.options.accessControllerAddress.split('/')[2]
        await self._ipfs.pin.rm(acAddress)
        const dagNode = await self._ipfs.dag.get(acAddress)
        await self._ipfs.pin.rm(dagNode.value.params.address)
      } catch (error) {
        self.logger(error)
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

      await self._ipfs.pin.add(log.address.root)
      await self.log.pinAccessController(log.options.accessControllerAddress)
      await this._registerEvents(log)
      await log.load()

      if (log._type === RecordStore.type) {
        self._logAddresses[log.address.toString()] = log.options.accessControllerAddress
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
