const { AboutEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    set: async function (data) {
      data.address = self.address.toString()

      const shouldPin = true
      const entry = await new AboutEntry().create(self._ipfs, data, shouldPin)
      const save = async () => {
        const hash = await self.put(entry)
        await self._ipfs.pin.add(hash)
        return this.get()
      }

      // save if no entry exists
      const currentEntry = self._index._index.about
      if (!currentEntry) {
        return save()
      }

      // save if new entry is different
      if (!entry.content.equals(currentEntry.payload.value.contentCID)) {
        return save()
      }

      // dont save
      return this.get()
    },

    get: async () => {
      return self._index._index.about
    }
  }
}
