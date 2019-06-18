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
      return log.tags.addTrack(entry, tag)
    },

    remove: async (trackId, tag) => {
      const log = self.log.mine()
      return log.tags.removeTrack(trackId, tag)
    }
  }
}
