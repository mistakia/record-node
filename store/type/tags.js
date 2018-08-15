module.exports = function (self ) {
  return {
    all: () => {
      return Object.keys(self._index._index.tags)
    },

    addTrack: async (trackData, tag) => {
      const entry = await self.tracks.add(trackData)
      const track = entry.payload.value.content

      tag = tag.toLowerCase()

      if (track.tags.includes(tag)) {
        throw new Error('tag already exists')
      }

      track.tags.push(tag)
      return self.tracks.add(track)
    },

    removeTrack: async (trackId, tag) => {
      const entry = await self.tracks.get(trackId)
      const track = entry.payload.value.content
      const idx = track.tags.indexOf(tag)

      if (idx === -1) {
        throw new Error('tag doesn\'t exist')
      }

      track.tags.splice(idx, 1)
      return self.tracks.add(track)
    }
  }
}
