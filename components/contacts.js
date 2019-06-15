const extend = require('deep-extend')
const { RecordStore } = require('../store')

module.exports = function contacts (self) {
  return {
    _init: async function () {
      const log = await self.log.mine()
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      for (const contact of contacts) {
        this.sync(contact)
      }
      self.logger(`All contacts loaded`)
    },

    sync: async (contact) => {
      const { address } = contact.content
      self.logger(`Syncing contact: ${address}`)
      const opts = { type: RecordStore.type, replicate: true }
      const log = await self._orbitdb.open(address, opts)

      log.events.on('replicate.progress', async (id, hash, entry) => {
        const { op } = entry.payload
        if (op !== 'PUT') {
          return
        }

        // TODO: consider including about entries in feed
        const { type } = entry.payload.value
        if (type !== 'about') {
          await self.feed.add(entry, contact)
        }
      })
      await log.load()
    },

    add: async ({ address, alias }) => {
      const log = await self.log.mine()
      const entry = await log.contacts.findOrCreate({ address, alias })
      await self.contacts.sync(entry.payload.value)
      await self.peers.update(address)
      return self.contacts.get(self.address, entry.payload.key)
    },

    getEntry: async (logId, contactId) => {
      const log = await self.log.get(logId)
      const entry = await log.contacts.getFromId(contactId)
      return entry ? entry.payload.value : {}
    },

    get: async (logId, contactId) => {
      const entry = await self.contacts.getEntry(logId, contactId)
      if (!entry || !entry.content) {
        return {}
      }

      const relations = await self.contacts.getRelations(entry)
      const profile = await self.profile.getEntry(entry.content.address)
      return extend(relations, profile, entry)
    },

    getRelations: async (contact, opts = {}) => {
      if (!contact || !contact.content) {
        return { isMe: false, haveContact: false }
      }

      let { haveContact } = opts

      const { address } = contact.content
      const isMe = self.isMe(address)

      if (!haveContact) {
        const myLog = await self.log.mine()
        haveContact = myLog.contacts.has(contact._id)
      }

      return { isMe, haveContact }
    },

    has: async (logId, contactId) => {
      const log = await self.log.get(logId)
      return log.contacts.has(contactId)
    },

    remove: async (contactId) => {
      const log = await self.log.mine()
      await log.contacts.del(contactId)
      return { _id: contactId }
    },

    list: async (logId) => {
      const log = await self.log.get(logId)
      const entries = await log.contacts.all()
      const haveContact = self.log.isMine(log)
      let contacts = []
      for (const entry of entries) {
        const profile = await self.profile.getEntry(entry.payload.value.content.address)
        const relations = await self.contacts.getRelations(entry.payload.value, { haveContact })
        contacts.push(extend(relations, profile, entry.payload.value))
      }
      return contacts
    }
  }
}
