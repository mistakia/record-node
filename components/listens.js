const { ListensStore } = require('../store')

module.exports = function listens (self) {
  return {
    _init: async () => {
      const opts = {
        create: true,
        replicate: true,
        type: ListensStore.type
      }
      self._listens = await self._orbitdb.open('listens', opts)
      // TODO re-enable pinning
      // await self._ipfs.pin.add(self._listens.address.root)

      // TODO re-enable pinning
      // const { accessControllerAddress } = self._listens.options
      // self.pinAC(accessControllerAddress)

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
    },

    getCount: (trackId) => {
      return self._listens.getCount(trackId)
    },

    list: async ({ start, limit } = {}) => {
      const listens = await self._listens.list({ start, limit })
      const entries = []
      for (const listen of listens) {
        const isLocal = await self._ipfs.repo.has(listen.cid)
        if (!isLocal) {
          continue
        }

        const track = await self.tracks.getFromCID(listen.cid)
        entries.push(track)
      }

      return entries
    }
  }
}
