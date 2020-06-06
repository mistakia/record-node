const { sha256 } = require('crypto-hash')
const extend = require('deep-extend')

const { loadEntryContent } = require('../utils')

module.exports = function logs (self) {
  return {
    _getEntryHash: async ({ address, linkAddress }) => {
      const key = await sha256(linkAddress)
      const rows = await self._db('entries')
        .select('hash')
        .where({ type: 'log', address, op: 'PUT', key })
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')
        .limit(1)

      return rows.length ? rows[0].hash : undefined
    },
    connect: async function (address) {
      if (address) {
        return this._connect(address)
      }

      self.isReplicating = true

      const links = await self._db('links').where({ address: self.address })
      const addresses = links.map(l => l.link)
      for (const address of addresses) {
        this._connect(address)
      }

      self.emit('redux', { type: 'LOGS_CONNECTED' })
    },

    disconnect: async function (address) {
      if (address) {
        return this._disconnect(address)
      }

      self.isReplicating = false

      const links = await self._db('links').where({ address: self.address })
      const addresses = links.map(l => l.link)
      for (const address of addresses) {
        this._disconnect(address)
      }

      self.emit('redux', { type: 'LOGS_DISCONNECTED' })
    },

    _connect: async (address) => {
      if (self.isMe(address)) {
        return
      }

      self.logger(`Connecting log: ${address}`)
      const log = await self.log.get(address, { replicate: true })
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

      self.emit('redux', { type: 'LOG_CONNECTED', payload: { address } })
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

      self.emit('redux', { type: 'LOG_DISCONNECTED', payload: { address } })
    },

    isReplicating: async (address) => {
      if (!self.log.isOpen(address)) {
        return false
      }

      const log = await self.log.get(address)
      return log.options.replicate
    },

    link: async ({ address = self.address, alias = null, linkAddress }) => {
      if (self.isMe(linkAddress)) {
        throw new Error(`unable to add self: ${linkAddress}`)
      }

      if (!self.isValidAddress(linkAddress)) {
        throw new Error(`invalid address: ${linkAddress}`)
      }

      self.logger(`Link log: ${linkAddress}`)
      const rows = await self._db('links')
        .where({ address, alias, link: linkAddress })
        .limit(1)

      const log = await self.log.get(address)
      if (!rows.length) {
        const data = { address: linkAddress, alias }
        await log.logs.put(data)
      }

      if (self.isReplicating) {
        self.logs._connect(linkAddress)
      }

      return self.logs.get({
        sourceAddress: self.address,
        targetAddress: linkAddress
      })
    },

    _getEntry: async (address, linkAddress) => {
      if (address === linkAddress) {
        return {}
      }

      const entryHash = await self.logs._getEntryHash({ address, linkAddress })
      if (!entryHash) {
        return {}
      }

      const log = await self.log.get(address, { replicate: false })
      const logEntry = await log.get(entryHash)
      const entry = await loadEntryContent(self._ipfs, logEntry)
      return entry ? entry.payload.value : {}
    },

    get: async ({ sourceAddress, targetAddress }) => {
      if (!targetAddress) {
        throw new Error('missing targetAddress')
      }

      if (!sourceAddress) {
        sourceAddress = targetAddress
      }

      const isMyLog = self.isMe(sourceAddress)
      let myEntry = {}
      if (!isMyLog) {
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

      const isLinked = isMyLog ? !!entry.id : !!myEntry.id
      let replicationStatus = {}
      let replicationStats = {}
      let length = 0
      let trackCount = 0
      let logCount = 0
      let isReplicating = false
      let isLoadingIndex = false
      let isProcessingIndex = false
      let heads = []

      if (self.log.isOpen(targetAddress)) {
        const log = await self.log.get(targetAddress)

        isReplicating = log.options.replicate
        replicationStatus = log.replicationStatus
        replicationStats = log._replicator._stats
        length = log._oplog._hashIndex.size
        heads = log._oplog.heads
        isLoadingIndex = self.indexer.isLoading(targetAddress)
        isProcessingIndex = self.indexer.isProcessing(targetAddress)
        trackCount = await self.indexer.trackCount(targetAddress)
        logCount = await self.indexer.logCount(targetAddress)
      }

      return extend(about, peerEntry, entry, myEntry, {
        isReplicating,
        isLoadingIndex,
        isProcessingIndex,
        trackCount,
        logCount,
        peers,
        replicationStatus,
        replicationStats,
        length,
        heads,
        isLinked,
        isMe: self.isMe(targetAddress)
      })
    },

    has: async (address, linkAddress) => {
      const rows = await self._db('links')
        .where({ address, link: linkAddress })
        .limit(1)

      return !!rows.length
    },

    unlink: async (linkAddress) => {
      self.logger(`Unlink log: ${linkAddress}`)
      const log = self.log.mine()
      const rows = await self._db('links')
        .where({ address: self.address, link: linkAddress })
        .limit(1)

      if (!rows.length) {
        throw new Error(`${linkAddress} is not linked`)
      }
      const id = await sha256(linkAddress)
      await log.logs.del(id)
      self.logs._disconnect(linkAddress)
      // TODO remove exclusive content, audio, artwork pins

      return { id, linkAddress }
    },

    all: async () => {
      const links = {}
      const linkedRows = await self._db('links')
      linkedRows.forEach(r => {
        links[r.address] = true
        links[r.link] = true
      })
      Object.keys(self._addresses).forEach(a => { links[a] = true })
      const addresses = Object.keys(links)
      const logs = []
      for (const address of addresses) {
        try {
          const log = await self.logs.get({
            sourceAddress: self.address,
            targetAddress: address
          })
          logs.push(log)
        } catch (err) {
          self.logger.error(err)
        }
      }

      return logs
    },

    _list: async (address) => {
      return self._db('links').where({ address })
    },

    list: async (address = self.address) => {
      const linkedRows = await self.logs._list(address)
      const getLog = (r) => self.logs.get({
        sourceAddress: address,
        targetAddress: r.link
      })
      const promises = linkedRows.map(r => getLog(r))
      return Promise.all(promises)
    }
  }
}
