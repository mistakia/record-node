const { sha256 } = require('crypto-hash')
const { generateAvatar } = require('../utils')

module.exports = function about (self) {
  return {
    set: async function (data, { logId } = {}) {
      const log = await self.log.get(logId)
      const entry = await log.about.set(data)
      return self.about.get(entry.payload.value.content.address)
    },
    get: async (logId) => {
      self.logger(`Get about for: ${logId}`)
      const log = await self.log.get(logId, { replicate: false })
      let entry = await log.about.get()
      let entryValue = entry ? entry.payload.value : { content: {} }

      if (!entryValue.id) {
        entryValue.id = await sha256(log.address.toString())
      }

      if (!entryValue.content.avatar) {
        entryValue.content.avatar = generateAvatar(logId)
      }

      if (!entryValue.content.address) {
        entryValue.content.address = log.address.toString()
      }

      return entryValue
    }
  }
}
