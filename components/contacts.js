module.exports = function contacts (self) {
  return {
    init: async function () => {
      const contacts = await self._log.contacts.all()
      for (const contact of contacts) {
        await this.sync(contact)
      }
      self.logger(`All contacts loaded`)
    },

    sync: async (contact) {
      const { address } = contact.payload.value.content
      const log = await self.getLog(address, { replicate: true })
      log.events.on('replicate.progress', async (id, hash, entry) => {
        await self.feed.add(entry)
      })
      await log.load()
    },

    add: async function ({ address, alias }) {
      const log = await self.getLog()
      const contact = await log.contacts.findOrCreate({ address, alias })
      this.sync(contact)
      return contact
    },

    // TODO: update

    remove: async (contactId) => {
      const log = await self.getLog()
      const hash = await log.contacts.del(contactId)
      return hash
    },

    list: async (logId) => {
      const log = await self.loadLog(logId)
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      return contacts
    }
  }
}
