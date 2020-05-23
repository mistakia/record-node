const { sha256 } = require('crypto-hash')

module.exports = function about (self) {
  return {
    set: async function ({ name = null, bio = null, location = null, avatar = null }, { address = self.address } = {}) {
      const rows = await self._db('logs')
        .where({ address, name, bio, location, avatar })

      if (!rows.length) {
        const log = await self.log.get(address)
        const data = { name, bio, location, avatar }
        await log.about.put(data)
        self.peers._announceLogs()
      }

      return self.about.get(address)
    },
    get: async (address) => {
      self.logger(`Get about for: ${address}`)
      const index = await self._db('entries')
        .where({ address, type: 'about' })
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')
        .limit(1)

      const log = await self.log.get(address, { replicate: false })
      const entry = index.length ? await log.getEntryWithContent(index[0].hash) : undefined
      const entryValue = entry ? entry.payload.value : { content: {} }

      if (!entryValue.id) {
        entryValue.id = await sha256(log.address.toString())
      }

      if (!entryValue.content.address) {
        entryValue.content.address = log.address.toString()
      }

      return entryValue
    }
  }
}
