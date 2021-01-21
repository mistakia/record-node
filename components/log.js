const extend = require('deep-extend')
const { CID } = require('ipfs-http-client')

const { throttle, loadEntryContent } = require('../utils')
const { RecordStore } = require('../store')
const Errors = require('../errors')

const logNameRe = /^[0-9a-zA-Z-]*$/
const timeout = ms => new Promise(resolve => setTimeout(resolve, ms))

/* const sortFn = (a, b) => {
 *   // TODO (medium) pass sortFn to orbitdb.open/create
 *   // sort by clocks
 *   // sort by entry payload timestamp
 *   // take first entry
 * }
 *  */
module.exports = function log (self) {
  return {
    _beforePut: async (recordEntry, { id }) => {
      if (recordEntry.content) {
        const address = id
        const cid = recordEntry.content
        const { tags, id: trackId } = recordEntry
        const entries = await self._db('entries').where({ cid, address: id })
        const length = tags && tags.length
        if (!length && entries.length) {
          // check tags for equality
          const tagRows = await self._db('tags').whereIn('tag', tags).where({ address, trackid: trackId })
          if (tags.length === tagRows.length && tagRows.filter(t => !tags.includes(t.tag)).length) {
            throw new Errors.DuplicateEntryError()
          }
        }
      }
    },

    _afterWrite: async (logEntry) => {
      const loadedEntry = await loadEntryContent(self._ipfs, logEntry)
      return self.indexer.add(loadedEntry)
    },

    _init: async (address = 'record') => {
      const opts = extend(
        {},
        self._options.store,
        { beforePut: self.log._beforePut, afterWrite: self.log._afterWrite },
        { create: true, replicate: true }
      )
      self._log = await self._orbitdb.open(address, opts)
      await self._ipfs.pin.add(self._log.address.root) // pin manifest
      await self.log.pinAccessController(self._log.options.accessControllerAddress)
      await self.log._registerEvents(self._log)
      await self._log.load()
    },

    mine: () => {
      return self._log
    },

    getLocalAddresses: async () => {
      const addresses = Object.keys(self._addresses)
      const localAddresses = []
      for (const address of addresses) {
        const isLocal = await self.log.isLocal(address)
        if (isLocal) localAddresses.push(address)
      }
      return localAddresses
    },

    getLocalLogs: async () => {
      const localAddresses = await self.log.getLocalAddresses()
      const logs = []
      for (const address of localAddresses) {
        try {
          const log = await self.log.get(address)
          logs.push(log)
        } catch (err) {
          self.logger.error(err)
        }
      }
      return logs
    },

    canAppend: async (address) => {
      try {
        const log = await self.log.get(address, { replicate: false })
        return log.access.write.includes(self.identity)
      } catch (err) {
        self.logger.error(err)
        return false
      }
    },

    isMine: (log) => {
      return self._log.address === log.address
    },

    isOpen: (address) => {
      return !!self._orbitdb.stores[address]
    },

    isEmpty: async (address) => {
      const log = await self.log.get(address, { replicate: false })
      return !(log._oplog._hashIndex.size || log._oplog._length)
    },

    isLocal: async (address) => {
      const parsedAddress = self.parseAddress(address)
      const haveManifest = self.log.haveManifest(parsedAddress.root)
      if (!haveManifest) {
        return false
      }

      const { accessController } = await self.log.getManifest(parsedAddress.root)
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

      const ac = await self._ipfs.dag.get(new CID(hash))
      const hasIPFSAC = await self._ipfs.repo.has(new CID(ac.value.params.address))
      if (!hasIPFSAC) {
        return false
      }

      return true
    },

    _registerEvents: async (log) => {
      const address = log.id

      log.events.on('peer', (peerId) => {
        self.emit('redux', {
          type: 'LOG_PEER_JOINED',
          payload: { address, peerId }
        })
      })

      const onProcessing = (processingCount) => {
        const isProcessingIndex = self.indexer.isProcessing(address)
        self.emit('redux', {
          type: 'LOG_INDEX_UPDATED',
          payload: { address, isProcessingIndex, processingCount }
        })
      }

      const throttledProcessing = throttle(onProcessing, 2500)
      log.events.on('processing', throttledProcessing)

      let updatedEntries = []
      const onIndexUpdated = async (processingCount) => {
        const trackCount = await self.indexer.trackCount(address)
        const logCount = await self.indexer.logCount(address)
        self.emit('redux', {
          type: 'LOG_INDEX_UPDATED',
          payload: {
            address,
            data: updatedEntries,
            isProcessingIndex: self.indexer.isProcessing(address),
            processingCount,
            trackCount,
            logCount
          }
        })
        updatedEntries = []
      }

      const throttledIndexUpdated = throttle(onIndexUpdated, 2500)
      log.events.on('indexUpdated', (processingCount, entry) => {
        updatedEntries.push(entry)
        throttledIndexUpdated(processingCount)
      })

      log.events.on('replicated', (address) => {
        self.emit('redux', {
          type: 'LOG_REPLICATED',
          payload: { address, replicationStatus: log.replicationStatus, replicationStats: log._replicator._stats, length: log._oplog._hashIndex.size }
        })
      })

      const onReplicateProgress = (address, hash, entry) => {
        self.emit('redux', {
          type: 'LOG_REPLICATE_PROGRESS',
          payload: { address, hash, entry, replicationStatus: log.replicationStatus, replicationStats: log._replicator._stats, length: log._oplog._hashIndex.size }
        })
      }

      const throttledReplicateProgress = throttle(onReplicateProgress, 2000)
      log.events.on('replicate.progress', (address, hash, entry, progress, total) => {
        self.logger(`new entry ${address}/${entry.hash}`)
        throttledReplicateProgress(address, hash, entry)
        self.indexer._process(entry)
        self._ipfs.pin.add(hash, { recursive: false })
        if (entry.payload.value.content) self._ipfs.pin.add(entry.payload.value.content, { recursive: false })
      })
    },

    pinAccessController: async (accessControllerAddress) => {
      self.logger(`pinning access controller address: ${accessControllerAddress}`)
      const acAddress = accessControllerAddress.split('/')[2]
      await self._ipfs.pin.add(acAddress)
      const dagNode = await self._ipfs.dag.get(acAddress)
      await self._ipfs.pin.add(dagNode.value.params.address)
    },

    getLogEntryFromId: async (address, id) => {
      const rows = await self._db('entries')
        .where({ address, key: id })
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')
        .limit(1)

      if (!rows.length) {
        return undefined
      }

      const hash = rows[0].hash
      const log = await self.log.get(address)
      return log.getEntryWithContent(hash)
    },

    drop: async function (address) {
      if (!address) {
        throw new Error('missing address')
      }

      if (self.isMe(address)) {
        throw new Error('Cannot drop default log')
      }

      await self.logs.unlink(address)
      self.logs._disconnect(address)

      self.logger(`dropping log ${address}`)
      const log = await self.log.get(address)
      if (log._type === RecordStore.type) {
        for (const hash of log._oplog._hashIndex.keys()) {
          const entry = await log._oplog.get(hash)
          await self._ipfs.pin.rm(entry.hash, { recursive: false }) // remove entry pins
        }
        await self.indexer.drop(address)
        delete self._addresses[address]
      }

      try {
        await self._ipfs.pin.rm(log.address.root) // remove manifest pin
        const acAddress = log.options.accessControllerAddress.split('/')[2]
        await self._ipfs.pin.rm(acAddress) // remove ac pin
        const dagNode = await self._ipfs.dag.get(acAddress)
        await self._ipfs.pin.rm(dagNode.value.params.address) // remove ipfs ac pin
      } catch (error) {
        self.logger(error)
      }

      // TODO (v0.0.2) remove from cache

      await log.drop(address)

      return { address }
    },

    get: async function (address = self.address, options = {}) {
      if (self.isMe(address)) {
        return self._log
      }

      if (self.listens.isMe(address)) {
        return self._listensLog
      }

      if (!self.isValidAddress(address)) {
        if (!options.create) {
          const addr = await self._orbitdb.determineAddress(address, RecordStore.type)
          address = addr.toString()
          options.localOnly = true
        } else if (!logNameRe.test(address)) {
          throw new Error(`${address} is not a valid log name`)
        }
      }

      if (this.isOpen(address)) {
        return self._orbitdb.stores[address]
      }

      const opts = extend({ replicate: false }, self._options.store, options)
      self.logger(`Loading log: ${address}`, opts)
      const log = await Promise.race([
        timeout(5000),
        self._orbitdb.open(address, opts)
      ])

      if (!log) {
        throw new Errors.CannotOpenLogError()
      }

      if (log._type === RecordStore.type) {
        const data = await self.logs.get({ targetAddress: address })
        self.emit('redux', {
          type: 'LOG_LOADING',
          payload: {
            data
          }
        })
      }

      await self._ipfs.pin.add(log.address.root) // pin manifest
      await self.log.pinAccessController(log.options.accessControllerAddress)
      await this._registerEvents(log)
      await log.load()

      // TODO (high) send to indexer

      if (log._type === RecordStore.type) {
        self._addresses[log.address.toString()] = log.options.accessControllerAddress
        const data = await self.logs.get({ targetAddress: address })
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
