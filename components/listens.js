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
      await self._listens.load()
    },

    get address () {
      return self._listens.address.toString()
    },

    isMe: (logId) => {
      return self._listens.address.toString() === logId
    },

    add: async (data) => {
      await self._listens.add(data)
    },

    list: async (start = null, end = 20) => {
      const entries = await self._listens.query({ start, end })
      return entries
    }
  }
}
