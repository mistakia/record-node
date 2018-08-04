module.exports = function tracks (self) {
  return {
    add: async ({ url, title }) => {
      const log = await self.getLog()
      const track = await log.tracks.findOrCreate({ url, title })
      return track
    },

    remove: async (trackId) => {
      const log = await self.getLog()
      const hash = await log.tracks.del(trackId)
      return hash
    },

    list: async (logId, opts) => {
      const log = await self.loadLog(logId)
      const entries = await log.tracks.all(opts)
      const tracks = entries.map(e => e.payload.value)
      return tracks
    }
  }
}
