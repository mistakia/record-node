module.exports = function tracks (self) {
  return {
    add: async ({ url, title }) => {
      const log = await self.log.get()
      const track = await log.tracks.findOrCreate({ url, title })
      return track
    },

    remove: async (trackId) => {
      const log = await self.log.get()
      const hash = await log.tracks.del(trackId)
      return hash
    },

    list: async (logId, opts) => {
      const log = await self.log.get(logId)
      let entries = await log.tracks.all(opts)

      if (!self.log.isMine(log)) {
        const myLog = await self.log.get()
        for (const index in entries) {
          const entry = entries[index]
          const trackId = entry.payload.key
          if (myLog.tracks.has(trackId)) {
            entries[index] = await myLog.tracks.get(trackId)
          }
        }
      }

      const tracks = entries.map(e => e.payload.value)
      return tracks
    }
  }
}
