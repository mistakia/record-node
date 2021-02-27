const { ListensStore } = require('../store')

module.exports = function listens (self) {
  return {
    _afterAdd: async (logEntry) => {
      return self.indexer._addListen(logEntry)
    },

    _init: async () => {
      self.logger.info('[node] initializing listens')
      const opts = {
        create: true,
        replicate: true,
        type: ListensStore.type,
        afterAdd: self.listens._afterAdd
      }
      self._listens = await self._orbitdb.open('listens', opts)
      // await self._ipfs.pin.add(self._listens.address.root) // pin manifest
      // await self.log.pinAccessController(self._listens.options.accessControllerAddress)
      await self._listens.load()
    },

    get address () {
      return self._listens.address.toString()
    },

    isMe: (address) => {
      return self._listens.address.toString() === address
    },

    add: async (data) => {
      await self._listens.add(data)
      return self.listens.getCount(data.trackId)
    },

    getCount: async (trackId) => {
      const rows = await self._db('listens').where({ trackid: trackId })
      const result = {
        trackId,
        count: rows.length,
        timestamps: rows.map(r => r.timestamp)
      }
      return result
    },

    list: async ({ start, limit } = {}) => {
      const listens = await self._listens.list({ start, limit })
      const entries = []
      for (const listen of listens) {
        const key = listen.trackId
        const rows = await self._db('entries')
          .where({ key })
          .orderBy('clock', 'desc')
          .orderBy('timestamp', 'desc')
          .limit(1)
        const { hash, address } = rows[0]
        const log = await self.log.get(address)
        const entry = await log.getEntryWithContent(hash)
        const track = await self.tracks._entryToTrack(entry, listen)
        entries.push(track)
      }

      return entries
    }
  }
}
