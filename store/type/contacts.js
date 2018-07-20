const mapSeries = require('p-map-series')

const { ContactEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (startIndex, endIndex) => {
      const entryHashes = Array.from(self._index._index.contact.values())
                               .reverse()
                               .slice(startIndex, endIndex)
                               .map(e => e.hash)

      const entries = await mapSeries(entryHashes, self._oplog.get.bind(self._oplog))
      return entries
    },

    findOrCreate: async function (data) {
      const entry = await new ContactEntry().create(data)
      let contact = await self.get(entry._id, 'contact')

      if (contact) {
        return contact
      }

      const hash = await this.add(data)
      contact = await self.get(entry._id, 'contact')
      return contact
    },

    add: async (data) => {
      const entry = await new ContactEntry().create(data)
      const hash = await self.put(entry)

      self.events.emit('contact', entry)

      return hash
    },

    get: async (id) => {
      const data = await self.get(id, 'contact')
      return data
    },

    del: (id) => {
      const hash = self.del(id, 'contact')
      return hash
    }
  }
}
