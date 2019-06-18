const { sha256 } = require('crypto-hash')
const extend = require('deep-extend')

module.exports = function contacts (self) {
  return {
    connect: async function (address) {
      if (address) {
        return this._connect(address)
      }

      const log = self.log.mine()
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      for (const contact of contacts) {
        const { address } = contact.content
        this._connect(address)
      }
    },

    disconnect: async function (address) {
      if (address) {
        return this._disconnect(address)
      }

      const log = self.log.mine()
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      for (const contact of contacts) {
        const { address } = contact.content
        this._disconnect(address)
      }
    },

    _connect: async (address) => {
      self.logger(`Connecting contact: ${address}`)
      const log = await self.log.get(address, { replicate: true })

      log.events.on('replicate.progress', async (id, hash, entry) => {
        self.logger(`new entry ${address}/${entry.hash}`)
        const { op } = entry.payload
        if (op !== 'PUT') {
          return
        }

        const { type } = entry.payload.value
        if (type !== 'about') {
          await self.feed.add({ entryType: type, entryId: entry.payload.key, logId: address })
        }
      })

      return log.load()
    },

    _disconnect: async (address) => {
      self.logger(`Disconnecting contact: ${address}`)
      if (!self.log.isOpen(address)) {
        return self.loggr(`log is not open: ${address}`)
      }

      const log = await self.log.get(address)

      if (!log.options.replicate) {
        return self.loggr(`log was not replicating: ${address}`)
      }

      return log.close()
    },

    isConnected: async (address) => {
      if (!self.log.isOpen(address)) {
        return false
      }

      const subs = await self._ipfs.pubsub.ls()
      return subs.includes(address)
    },

    add: async ({ address, alias }) => {
      const log = self.log.mine()
      const entry = await log.contacts.findOrCreate({ address, alias })
      await self.contacts.connect(entry.payload.value)
      return self.contacts.get({
        logId: self.address,
        contactId: entry.payload.key,
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
        myEntry = self.contacts._getEntry(self.address, contactId)
      }

      let peerEntry = {}
      if (self.peers.get(contactId)) {
        peerEntry = self.peers.get(contactId)
      }

      const [ entry, about, isConnected ] = await Promise.all([
        self.contacts._getEntry(logId, contactId),
        self.about.get(contactAddress),
        self.contacts.isConnected(contactAddress)
      ])

      return extend(about, peerEntry, entry, myEntry, {
        isConnected,
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
      await log.contacts.del(contactId)
      return { _id: contactId }
    },

    all: async () => {
      const all = new Map()

      const considerContact = async (contact) => {
        const haveContact = await self.contacts.has(self.address, contact._id)
        if (!haveContact) {
          const suggestedContact = all.get(contact._id)
          const count = suggestedContact ? suggestedContact.count++ : 0
          all.set(contact._id, extend(contact, { count }))
        }
      }

      const contacts = await self.contacts.list(self.address)
      for (const contact of contacts) {
        all.set(contact._id, contact)
        const contactsOfContact = await self.contacts.list(contact.content.address)
        for (const contactOfContact of contactsOfContact) {
          await considerContact(contactOfContact)
        }
      }

      return Array.from(all.values())
    },

    list: async (logId) => {
      const log = await self.log.get(logId, { replicate: false })
      const entries = await log.contacts.all()
      const getContact = (e) => self.contacts.get({
        logId,
        contactId: e.payload.value._id,
        contactAddress: e.payload.value.content.address
      })
      const promises = entries.map(e => getContact(e))
      return Promise.all(promises)
    }
  }
}
