module.exports = function tags (self) {
  return {
    list: async (logAddress) => {
      const log = await self.log.get(logAddress, { replicate: false })
      const tags = await log.tags.all()
      return tags
    },

    add: async (cid, tag) => {
      if (!cid) {
        throw new Error('missing cid')
      }

      if (!tag) {
        throw new Error('missing tag')
      }

      const log = self.log.mine()
      const track = await self.tracks.addTrackFromCID(cid)
      await log.tags.addTrack(track, tag)
      return self.tracks.get(log.address, track.id)
    },

    remove: async (trackId, tag) => {
      if (!trackId) {
        throw new Error('missing trackId')
      }

      if (!tag) {
        throw new Error('missing tag')
      }

      const log = self.log.mine()
      await log.tags.removeTrack(trackId, tag)
      return self.tracks.get(log.address, trackId)
    }
  }
}
