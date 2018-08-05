module.exports = function tags (self) {
  return {
    list: async (logId) => {
      const log = await self.log.get(logId)
      const tags = await log.tags.all()
      return tags
    },

    add: async (track, tag) => {
      const log = await self.log.get()
      const entry = await log.tags.addTrack(track, tag)
      return entry.payload.value
    },

    remove: async (trackId, tag) => {
      const log = await self.log.get()
      const entry = await log.tags.removeTrack(trackId, tag)
      return entry.payload.value
    }
  }
}
