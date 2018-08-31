const extend = require('deep-extend')
const { sha256 } = require('crypto-hash')
const { generateAvatar } = require('../utils')

module.exports = function profile (self) {
  return {
    set: async function (data) {
      const log = await self.log.mine()
      const entry = await log.about.set(data)
      return self.profile.get(entry.payload.value.content.address)
    },
    getEntry: async (logId) => {
      const log = await self.log.get(logId)
      let entry = log.about.get()
      let entryValue = entry ? entry.payload.value : { content: {} }

      if (!entryValue._id) {
        entryValue._id = await sha256(log.address.toString())
      }

      if (!entryValue.content.avatar) {
        entryValue.content.avatar = generateAvatar(entryValue._id)
      }

      return entryValue
    },
    get: async (logId) => {
      self.logger(`Get profile for: ${logId}`)
      const entry = await self.profile.getEntry(logId)

      if (self.isMe(logId)) {
        entry.content.address = self.address
        return extend(entry, { isMe: true }, { haveContact: false })
      }

      const contact = await self.contacts.get(self.address, entry._id)
      const relations = await self.contacts.getRelations(contact)

      return extend(relations, entry, contact)
    }
  }
}
