module.exports = function contacts (self) {
  return {
    _index: {},
    sync: async function () {
      self.logger('Loading contacts to sync')

      const contacts = await self._log.contacts.all()
      contacts.forEach(async (contact) => {
        const { address } = contact.payload.value.content
        if (this._index[address]) { return }

        self.logger(`Loading contact: ${address}`)
        const log = await self.getLog(address, { replicate: true })
        log.events.on('replicate.progress', async (id, hash, entry) => {
          await self.feed.add(entry)
        })
        this._index[address] = log
        await log.load()
      })
      self.logger(`All contacts loaded`)
    },

    add: async ({ address, alias }) => {
      const log = await self.getLog()
      const contact = await log.contacts.findOrCreate({ address, alias })
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
