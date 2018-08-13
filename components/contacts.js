module.exports = function contacts (self) {
  return {
    init: async function () {
      const contacts = await self.contacts.list()
      for (const contact of contacts) {
        await this.sync(contact)
      }
      self.logger(`All contacts loaded`)
    },

    sync: async (contact) => {
      const { address } = contact.content
      self.logger(`Syncing contact: ${address}`)
      const log = await self.log.get(address, { replicate: true })
      log.events.on('replicate.progress', async (id, hash, entry) => {
        await self.feed.add(entry, contact)
      })
      await log.load()
    },

    add: async ({ address, alias }) => {
      const log = await self.log.get()
      const contact = await log.contacts.findOrCreate({ address, alias })

      return contact
    },

    get: async (logId, contactId) => {
      const log = await self.log.get(logId)
      const contact = await log.contacts.get(contactId)
      return contact
    },

    // TODO: update

    remove: async (contactId) => {
      const log = await self.log.get()
      const hash = await log.contacts.del(contactId)
      return hash
    },

    list: async (logId) => {
      const log = await self.log.get(logId)
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      return contacts
    }
  }
}
