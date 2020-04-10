module.exports = function (self) {
  return {
    all: () => {
      const { tags } = self._index._index
      return Object.keys(tags).map(tag => ({ tag, count: tags[tag] }))
    },

    addTrack: async (track, tag) => {
      tag = tag.toLowerCase()

      const { tags, content } = track

      if (tags.includes(tag)) {
        throw new Error('tag already exists')
      }

      tags.push(tag)

      return self.tracks.add(content, tags)
    },

    removeTrack: async (trackId, tag) => {
      const entry = await self.tracks.getFromId(trackId)
      const { tags, content } = entry.payload.value

      const idx = tags.indexOf(tag)
      if (idx === -1) {
        throw new Error('tag doesn\'t exist')
      }

      tags.splice(idx, 1)
      return self.tracks.add(content, tags)
    }
  }
}
