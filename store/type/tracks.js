const { CID } = require('ipfs')
const { TrackEntry } = require('../RecordEntry')

module.exports = function (self) {
  return {
    all: async (opts = {}) => {
      let { start, end, random, query } = opts
      const tags = opts.tags && !Array.isArray(opts.tags) ? [opts.tags] : (opts.tags || [])

      if (tags.length && !tags.some(t => self._index.hasTag(t))) {
        return []
      }

      if (random) {
        start = Math.floor(Math.random() * self._index._index.track.size)
        end = start + 1
      }

      let entryHashes = []

      if (query) {
        let results = []
        if (tags.length) {
          results = await self._index._searchIndex.search(query, { where: (doc) => {
            return tags.every((tag) => {
              return doc.tags.indexOf(tag) !== -1
            })
          }})
        } else {
          results = await self._index._searchIndex.search(query)
        }

        entryHashes = results.map(e => self._index._index.track.get(e.key).hash)
      } else {
        const indexEntries = Array
          .from(self._index._index.track.values())
          .reverse()
          .slice(start, end)

        if (tags.length) {
          let i = 0
          while (entryHashes.length < (end || Infinity) && indexEntries[i]) {
            if (tags.every(t => indexEntries[i].tags.includes(t))) {
              entryHashes.push(indexEntries[i].hash)
            }
            i++
          }
        } else {
          entryHashes = indexEntries.map(e => e.hash)
        }
      }

      let promises = entryHashes.map(e => self.tracks.getFromHash(e))
      return Promise.all(promises)
    },

    has: (id) => {
      return !!self._index.getEntryHash(id, 'track')
    },

    findOrCreate: async function (content) {
      const entry = await new TrackEntry().create(self._ipfs, content)
      let track = await self.get(entry.id, 'track')

      if (!track) {
        return this._add(entry)
      }

      const contentCID = track.payload.value.cid || track.payload.value.content

      if (!entry.content.equals(contentCID)) {
        return this._add(entry)
      }

      return self.tracks._loadContent(track)
    },

    _add: async (entry) => {
      await self.put(entry)
      return self.tracks.getFromId(entry.id)
    },

    add: async (content, tags) => {
      const entry = await new TrackEntry().create(self._ipfs, content, tags)
      return self.tracks._add(entry)
    },

    _loadContent: async (entry) => {
      if (!entry) {
        return null
      }

      // convert entry content cid to value of dagNode
      if (CID.isCID(entry.payload.value.content)) {
        entry.payload.value.cid = entry.payload.value.content
        entry.payload.value.contentCID = entry.payload.value.content.toBaseEncodedString('base58btc')
        const dagNode = await self._ipfs.dag.get(entry.payload.value.content, { localResolve: true })
        entry.payload.value.content = dagNode.value

        const { content } = entry.payload.value
        if (CID.isCID(content.hash)) {
          entry.payload.value.content.hash = content.hash.toBaseEncodedString('base58btc')
        }

        // convert artwork cids to string
        entry.payload.value.content.artwork = content.artwork.map((a) => {
          return CID.isCID(a) ? a.toBaseEncodedString('base58btc') : a
        })
      }

      return entry
    },

    getFromResolverId: async (extractor, id) => {
      const indexEntries = Array.from(self._index._index.track.values())
      const indexEntry = indexEntries.find((entry) => {
        return entry.resolver.find(r => r === `${extractor}:${id}`)
      })

      if (!indexEntry) {
        return null
      }

      return self.tracks.getFromHash(indexEntry.hash)
    },

    getFromId: async (id) => {
      const entry = await self.get(id, 'track')
      return self.tracks._loadContent(entry)
    },

    getFromHash: async (hash) => {
      const entry = await self._oplog.get(hash)
      return self.tracks._loadContent(entry)
    },

    del: (id) => {
      const hash = self.del(id, 'track')
      return hash
    }
  }
}
