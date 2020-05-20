const extend = require('deep-extend')

module.exports = function logs (self) {
  return {
    connect: async function (address) {
      if (address) {
        return this._connect(address)
      }

      self.isReplicating = true

      const log = self.log.mine()
      const entries = await log.logs.all()
      const values = entries.map(e => e.payload.value)
      for (const value of values) {
        const { address } = value.content
        this._connect(address, { pin: true })
      }

      self.emit('redux', { type: 'LOGS_CONNECTED' })
    },

    disconnect: async function (address) {
      if (address) {
        return this._disconnect(address)
      }

      self.isReplicating = false

      const log = self.log.mine()
      const entries = await log.logs.all()
      const values = entries.map(e => e.payload.value)
      for (const value of values) {
        const { address } = value.content
        this._disconnect(address)
      }

      self.emit('redux', { type: 'LOGS_DISCONNECTED' })
    },

    _connect: async (address, { pin = false } = {}) => {
      if (self.isMe(address)) {
        return
      }

      self.logger(`Connecting log: ${address}`)
      const log = await self.log.get(address, { replicate: true, pin })
      self.logger(`Connected log: ${address}`)

      if (!log.options.replicate) {
        try {
          log.options.replicate = true
          await self._orbitdb._pubsub.subscribe(
            address,
            self._orbitdb._onMessage.bind(self._orbitdb),
            self._orbitdb._onPeerConnected.bind(self._orbitdb)
          )
          log._replicator.resume()
        } catch (e) {
          self.logger.error(e)
        }
      }

      self.emit('redux', { type: 'LOG_CONNECTED', payload: { logAddress: address } })
    },

    _disconnect: async (address) => {
      if (self.isMe(address)) {
        return
      }

      self.logger(`Disconnecting log: ${address}`)
      if (!self.log.isOpen(address)) {
        return self.logger(`log is not open: ${address}`)
      }

      const log = await self.log.get(address)

      if (!log.options.replicate) {
        return self.logger(`log was not replicating: ${address}`)
      }

      await self._orbitdb._pubsub.unsubscribe(address)
      log.options.replicate = false
      log._replicator.pause()

      self.emit('redux', { type: 'LOG_DISCONNECTED', payload: { logAddress: address } })
    },

    isReplicating: async (address) => {
      if (!self.log.isOpen(address)) {
        return false
      }

      const log = await self.log.get(address)
      return log.options.replicate
    },

    link: async ({ logAddress, alias, linkAddress }) => {
      if (self.isMe(linkAddress)) {
        throw new Error(`unable to add self: ${linkAddress}`)
      }

      if (!self.isValidAddress(linkAddress)) {
        throw new Error(`invalid address: ${linkAddress}`)
      }

      self.logger(`Link log: ${linkAddress}`)
      const log = await self.log.get(logAddress)
      const logEntry = await log.logs.findOrCreate({ address: linkAddress, alias }, { pin: true })
      if (self.isReplicating) {
        self.logs._connect(linkAddress, { pin: true })
      }

      // iterate log entries and pin
      const linkedLog = await self.log.get(logEntry.payload.value.content.address)
      for (const hash of linkedLog._oplog._hashIndex.keys()) {
        const entry = await log._oplog.get(hash)
        await self._ipfs.pin.add(entry.hash, { recursive: false })
        const { content } = entry.payload.value
        if (content) await self._ipfs.pin.add(content.toString(), { recursive: false })
      }

      return self.logs.get({
        sourceAddress: self.address,
        targetAddress: linkAddress
      })
    },

    _getEntry: async (logAddress, linkedAddress) => {
      if (logAddress === linkedAddress) {
        return {}
      }

      const log = await self.log.get(logAddress, { replicate: false })
      const entry = await log.logs.getFromAddress(linkedAddress)
      return entry ? entry.payload.value : {}
    },

    get: async ({ sourceAddress, targetAddress }) => {
      if (!targetAddress) {
        throw new Error('missing targetAddress')
      }

      if (!sourceAddress) {
        sourceAddress = targetAddress
      }

      let myEntry = {}
      if (!self.isMe(sourceAddress)) {
        myEntry = await self.logs._getEntry(self.address, targetAddress)
      }

      let peerEntry = {}
      if (self.peers.get(targetAddress)) {
        peerEntry = self.peers.get(targetAddress)
      }

      const [entry, about, peers] = await Promise.all([
        self.logs._getEntry(sourceAddress, targetAddress),
        self.about.get(targetAddress),
        self._ipfs.pubsub.peers(targetAddress)
      ])

      let replicationStatus = {}
      let replicationStats = {}
      let length = 0
      let trackCount = 0
      let logCount = 0
      let isReplicating = false
      let isBuildingIndex = false
      let isProcessingIndex = false
      let heads = []

      if (self.log.isOpen(targetAddress)) {
        const log = await self.log.get(targetAddress)

        isReplicating = log.options.replicate
        replicationStatus = log.replicationStatus
        replicationStats = log._replicator._stats
        length = log._oplog._hashIndex.size
        heads = log._oplog.heads
        isBuildingIndex = log._index.isBuilding
        isProcessingIndex = log._index.isProcessing
        trackCount = log._index.trackCount
        logCount = log._index.logCount
      }

      return extend(about, peerEntry, entry, myEntry, {
        isReplicating,
        isBuildingIndex,
        isProcessingIndex,
        trackCount,
        logCount,
        peers,
        replicationStatus,
        replicationStats,
        length,
        heads,
        isLinked: !!myEntry.id || self.log.mine().logs.hasId(entry.id),
        isMe: self.isMe(targetAddress)
      })
    },

    has: async (logAddress, linkedAddress) => {
      const log = await self.log.get(logAddress, { replicate: false })
      return log.logs.hasAddress(linkedAddress)
    },

    unlink: async (linkAddress) => {
      self.logger(`Unlink log: ${linkAddress}`)
      const log = self.log.mine()
      const logEntry = await log.logs.getFromAddress(linkAddress)
      await log.logs.del(logEntry.payload.value.id, { pin: true }) // remove from log
      await self.log.removePins(logEntry.payload.value.content.address)
      self.logs._disconnect(logEntry.payload.value.content.address) // disconnect pubsub

      return { id: logEntry.id, linkAddress }
    },

    all: async () => {
      const all = new Map()

      const considerLog = async (log) => {
        const isLinked = await self.logs.has(self.address, log.content.address)
        if (!isLinked) {
          const suggestedLog = all.get(log.id)
          const count = suggestedLog ? suggestedLog.count++ : 0
          all.set(log.id, extend(log, { count }))
        }
      }

      const logs = await self.logs.list(self.address)
      for (const log of logs) {
        all.set(log.id, log)
        const linkedLogs = await self.logs.list(log.content.address)
        for (const linkedLog of linkedLogs) {
          await considerLog(linkedLog)
        }
      }

      const logAddresses = Object.keys(self._logAddresses)
      for (const logAddress of logAddresses) {
        const c = await self.logs.get({ targetAddress: logAddress })
        all.set(c.id, c)
      }

      return Array.from(all.values())
    },

    list: async (logAddress) => {
      const log = await self.log.get(logAddress, { replicate: false })
      const entries = await log.logs.all()
      const getLog = (e) => self.logs.get({
        sourceAddress: logAddress,
        targetAddress: e.payload.value.content.address
      })
      const promises = entries.map(e => getLog(e))
      return Promise.all(promises)
    }
  }
}
