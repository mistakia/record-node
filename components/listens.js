const { ListensStore } = require('../store')

module.exports = function listens (self) {
  return {
    _init: async () => {
      const opts = {
        create: true,
        replicate: true,
        pin: true,
        type: ListensStore.type
      }
      self._listens = await self._orbitdb.open('listens', opts)
      await self.log.pinAccessController(self._listens.options.accessControllerAddress)
      await self._listens.load()
    },

    get address () {
      return self._listens.address.toString()
    },

    isMe: (logAddress) => {
      return self._listens.address.toString() === logAddress
    },

    add: async (data) => {
      await self._listens.add(data)
      return self.listens.getCount(data.trackId)
    },

    getCount: (trackId) => {
      return self._listens.getCount(trackId)
    },

    list: async ({ start, limit } = {}) => {
      const listens = await self._listens.list({ start, limit })
      const entries = []
      for (const listen of listens) {
        // TODO - check for missing cids
        const track = await self.tracks.getFromCID(listen.cid, listen.trackId)
        entries.push(track)
      }

      return entries
    }
  }
}
