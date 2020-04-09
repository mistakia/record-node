module.exports = function tags (self) {
  return {
    list: async (logId) => {
      const log = await self.log.get(logId, { replicate: false })
      const tags = await log.tags.all()
      return tags
    },

    add: async (cid, tag) => {
      const log = self.log.mine()
      const entry = await self.tracks.addTrackFromCID(cid)
      await log.tags.addTrack(entry, tag)
      return self.tracks.get(log.address, entry.payload.value.id)
    },

    remove: async (trackId, tag) => {
      const log = self.log.mine()
      return log.tags.removeTrack(trackId, tag)
    }
  }
}
