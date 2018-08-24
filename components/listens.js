const { RecordListensStore } = require('../store')

module.exports = function listens (self) {
  return {
    init: async () => {
      const opts = {
        create: true,
        replicate: true,
        type: RecordListensStore.type
      }
      self._listensLog = await self._orbitdb.open('listens', opts)
      await self._listensLog.load()
    },

    get address () {
      return self._listensLog.address.toString()
    },

    isMe: (logId) => {
      return self._listensLog.address.toString() === logId
    },

    add: async (data) => {
      await self._listensLog.add(data)
    },

    list: async (start = null, limit = 20) => {
      const entries = await self._listensLog.query({ start, limit })
      return entries
    }
  }
}
