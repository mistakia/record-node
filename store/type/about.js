const { AboutEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    set: async function (data) {
      data.address = self.address.toString()

      const save = async () => {
        const entry = await new AboutEntry().create(data)
        await self.put(entry)
        return this.get()
      }

      const currentEntry = this.get()

      // save if no profile exists
      if (!currentEntry) {
        return await save()
      }

      // save if new profile is different
      const { content } = currentEntry.payload.value
      if (JSON.stringify(content) !== JSON.stringify(data)) {
        return await save()
      }

      // dont save
      return this.get()
    },

    get: () => {
      return self._index._index.about
    }
  }
}
