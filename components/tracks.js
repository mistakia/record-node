module.exports = function tracks (self) {
  return {
    add: async ({ url, title }) => {
      const log = await self.log.mine()
      const track = await log.tracks.findOrCreate({ url, title })
      return track
    },

    get: async (logId, trackId) => {
      const log = await self.log.get(logId)
      const entry = await log.tracks.get(trackId)
      return entry.payload.value
    },

    remove: async (trackId) => {
      const log = await self.log.mine()
      const cid = await log.tracks.del(trackId)
      return cid
    },

    list: async (logId, opts) => {
      const log = await self.log.get(logId)
      let entries = await log.tracks.all(opts)

      if (!self.log.isMine(log)) {
        const myLog = await self.log.mine()
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
