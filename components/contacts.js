const { sha256 } = require('crypto-hash')
const extend = require('deep-extend')

module.exports = function contacts (self) {
  return {
    connect: async function (address, contactId) {
      if (address) {
        return this._connect(address, contactId)
      }

      self.isReplicating = true

      const log = self.log.mine()
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      for (const contact of contacts) {
        const { address } = contact.content
        this._connect(address, contact.id, true)
      }

      self.emit('redux', { type: 'CONTACTS_CONNECTED' })
    },

    disconnect: async function (address) {
      if (address) {
        const contactId = await sha256(address)
        return this._disconnect(address, contactId)
      }

      self.isReplicating = false

      const log = self.log.mine()
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      for (const contact of contacts) {
        const { address } = contact.content
        this._disconnect(address, contact.id)
      }

      self.emit('redux', { type: 'CONTACTS_DISCONNECTED' })
    },

    _connect: async (address, contactId, pin = false) => {
      if (self.isMe(address)) {
        return
      }

      self.logger(`Connecting contact: ${address}`)
      const log = await self.log.get(address, { replicate: true, pin })
      self.logger(`Connected contact: ${address}`)

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
          console.log(e)
        }
      }

      self.emit('redux', { type: 'CONTACT_CONNECTED', payload: { logId: address, contactId } })
    },

    _disconnect: async (address, contactId) => {
      if (self.isMe(address)) {
        return
      }

      self.logger(`Disconnecting contact: ${address}`)
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

      self.emit('redux', { type: 'CONTACT_DISCONNECTED', payload: { logId: address, contactId } })
    },

    isReplicating: async (address) => {
      if (!self.log.isOpen(address)) {
        return false
      }

      const log = await self.log.get(address)
      return log.options.replicate
    },

    add: async ({ address, alias, logId }) => {
      if (self.isMe(address)) {
        throw new Error(`unable to add self: ${address}`)
      }

      if (!self.isValidAddress(address)) {
        throw new Error(`invalid address: ${address}`)
      }

      const log = await self.log.get(logId)
      const contactEntry = await log.contacts.findOrCreate({ address, alias })
      if (self.isReplicating) {
        self.contacts._connect(address, contactEntry.payload.key, true)
      }

      // TODO go through log and pin any local hashes
      /* const contactLog = await self.log.get(contactEntry.payload.value.content.address)
       * for (const hash of contactLog._oplog._hashIndex.keys()) {
       *   const entry = await log._oplog.get(hash)
       *   const { content } = entry.payload.value
       *   const { key } = entry.payload

       *   await self._ipfs.pin.add(content, { recursive: false }) // add content pin
       *   await self._ipfs.pin.add(key, { recursive: false }) // add log entry pins
       * }
       */
      return self.contacts.get({
        logId: self.address,
        contactId: contactEntry.payload.key,
        contactAddress: address
      })
    },

    _getEntry: async (logId, contactId) => {
      const log = await self.log.get(logId, { replicate: false })
      const entry = await log.contacts.getFromId(contactId)
      return entry ? entry.payload.value : {}
    },

    get: async ({ logId, contactId, contactAddress }) => {
      if (!contactId) {
        contactId = await sha256(contactAddress)
      }

      let myEntry = {}
      if (!self.isMe(logId)) {
        myEntry = await self.contacts._getEntry(self.address, contactId)
      }

      let peerEntry = {}
      if (self.peers.get(contactId)) {
        peerEntry = self.peers.get(contactId)
      }

      const [entry, about, peers] = await Promise.all([
        self.contacts._getEntry(logId, contactId),
        self.about.get(contactAddress),
        self._ipfs.pubsub.peers(contactAddress)
      ])

      let replicationStatus = {}
      let replicationStats = {}
      let length = 0
      let trackCount = 0
      let contactCount = 0
      let isReplicating = false
      let isBuildingIndex = false
      let isProcessingIndex = false
      let heads = []

      if (self.log.isOpen(contactAddress)) {
        const log = await self.log.get(contactAddress)

        isReplicating = log.options.replicate
        replicationStatus = log.replicationStatus
        replicationStats = log._replicator._stats
        length = log._oplog._hashIndex.size
        heads = log._oplog.heads
        isBuildingIndex = log._index.isBuilding
        isProcessingIndex = log._index.isProcessing
        trackCount = log._index.trackCount
        contactCount = log._index.contactCount
      }

      return extend(about, peerEntry, entry, myEntry, {
        isReplicating,
        isBuildingIndex,
        isProcessingIndex,
        trackCount,
        contactCount,
        peers,
        replicationStatus,
        replicationStats,
        length,
        heads,
        haveContact: self.log.mine().contacts.has(contactId),
        isMe: self.isMe(contactAddress)
      })
    },

    has: async (logId, contactId) => {
      const log = await self.log.get(logId, { replicate: false })
      return log.contacts.has(contactId)
    },

    remove: async (contactId) => {
      const log = self.log.mine()
      const contactEntry = await log.contacts.getFromId(contactId)
      await log.contacts.del(contactId)

      const contactLog = await self.log.get(contactEntry.payload.value.content.address)
      for (const hash of contactLog._oplog._hashIndex.keys()) {
        const entry = await log._oplog.get(hash)
        const { content, type } = entry.payload.value
        const { key } = entry.payload

        // TODO
        /* await self.checkContentPin({ id: key, cid: content, type }) // removes exclusive content pins
         * await self._ipfs.pin.rm(key, { recursive: false }) // removes log entry pins */
      }

      return { id: contactId }
    },

    all: async () => {
      const all = new Map()

      const considerContact = async (contact) => {
        const haveContact = await self.contacts.has(self.address, contact.id)
        if (!haveContact) {
          const suggestedContact = all.get(contact.id)
          const count = suggestedContact ? suggestedContact.count++ : 0
          all.set(contact.id, extend(contact, { count }))
        }
      }

      const contacts = await self.contacts.list(self.address)
      for (const contact of contacts) {
        all.set(contact.id, contact)
        const contactsOfContact = await self.contacts.list(contact.content.address)
        for (const contactOfContact of contactsOfContact) {
          await considerContact(contactOfContact)
        }
      }

      const logIds = Object.keys(self._logs)
      for (let i = 0; i < logIds.length; i++) {
        const logId = logIds[i]
        const c = await self.contacts.get({ logId, contactAddress: logId })
        all.set(c.id, c)
      }

      return Array.from(all.values())
    },

    list: async (logId) => {
      const log = await self.log.get(logId, { replicate: false })
      const entries = await log.contacts.all()
      const getContact = (e) => self.contacts.get({
        logId,
        contactId: e.payload.value.id,
        contactAddress: e.payload.value.content.address
      })
      const promises = entries.map(e => getContact(e))
      return Promise.all(promises)
    }
  }
}
