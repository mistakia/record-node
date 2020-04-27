const { sha256 } = require('crypto-hash')

module.exports = function about (self) {
  return {
    set: async function (data, { logAddress } = {}) {
      const log = await self.log.get(logAddress)
      const entry = await log.about.set(data)
      self.peers._announceLogs()
      return self.about.get(entry.payload.value.content.address)
    },
    get: async (logAddress) => {
      self.logger(`Get about for: ${logAddress}`)
      let entry, log
      try {
        log = await self.log.get(logAddress, { replicate: false })
        entry = log.about.get()
      } catch (error) {
        self.logger.err(error)
      }
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
