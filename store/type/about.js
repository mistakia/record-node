const { AboutEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    set: async function (data) {
      data.address = self.address.toString()

      const entry = await new AboutEntry().create(self._ipfs, data)
      const save = async () => {
        await self.put(entry)
        return this.get()
      }

      // save if no profile exists
      const currentEntry = self._index._index.about
      if (!currentEntry) {
        return save()
      }

      // save if new profile is different
      if (!entry.content.equals(currentEntry.payload.value.content)) {
        return save()
      }

      // dont save
      return this.get()
    },

    get: async () => {
      const { CID } = self._ipfs.types
      const entry = JSON.parse(JSON.stringify(self._index._index.about))
      const { content } = entry.payload.value
      const cid = new CID(content.version, content.codec, Buffer.from(content.hash.data))
      const dagNode = await self._ipfs.dag.get(cid)
      entry.payload.value.content = dagNode.value
      return entry
    }
  }
}
