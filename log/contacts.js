const ContactEntry = require('./ContactEntry')

module.exports = function (self) {
  function filterEntries (mapper) {
    return (doc) => {
      if (doc.type !== 'contact') { return false }

      return mapper ? mapper(doc) : true
    }
  }

  return {
    all: (mapper) => {
      const all = self._log.query(filterEntries(mapper))
      return all
    },

    findOrCreate: async function (data) {
      const entry = await new ContactEntry().create(data)
      let contact = this.get(entry._id)

      if (contact.length) { return contact }

      const hash = await this.add(data)
      contact = this.get(entry._id)
      return contact
    },

    add: async (data) => {
      const entry = await new ContactEntry().create(data)
      const hash = await self._log.put(entry)

      // TODO:
      // self.syncContacts()

      return hash
    },

    get: (key) => {
      const data = self._log.get(key)
      return data
    },

    del: async (key) => {
      const hash = await self._log.del(key)
      return hash
    }
  }
}
