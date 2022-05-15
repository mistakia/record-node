const { CID } = require('ipfs-http-client')

module.exports = function tags (self) {
  return {
    list: async (addresses = []) => {
      if (!Array.isArray(addresses)) {
        addresses = [addresses]
      }

      let sql = self._db('tags').groupBy('tag')
      if (addresses.length) {
        sql = sql.whereIn('address', addresses)
      }

      const tags = await sql

      return tags
    },

    add: async (cid, tag) => {
      if (!cid) {
        throw new Error('missing cid')
      }

      if (!tag) {
        throw new Error('missing tag')
      }
      self.logger.info(`[node] adding tag: ${tag}`)

      const tracks = await self._db('tracks')
        .innerJoin('entries', 'tracks.id', 'entries.key')
        .where({ cid })
        .where('tracks.address', self.address)
        .limit(1)

      let tags = []
      if (tracks.length) {
        const trackid = tracks[0].id
        const rows = await self._db('tags')
          .where({ address: self.address, trackid })

        tags = rows.map(r => r.tag)
        if (tags.includes(tag)) {
          throw new Error('tag exists')
        }
      }
      tags.push(tag)

      cid = CID.asCID(cid) || CID.parse(cid)
      const dagNode = await self._ipfs.dag.get(cid)
      const content = dagNode.value
      const log = self.log.mine()
      const entry = await log.tracks.put(content, tags)
      const track = await self.tracks._entryToTrack(entry, log.address.toString())
      return track
    },

    remove: async (trackId, tag) => {
      if (!trackId) {
        throw new Error('missing trackId')
      }

      if (!tag) {
        throw new Error('missing tag')
      }

      self.logger.info(`[node] removing tag: ${tag}`)

      const rows = await self._db('tags')
        .where({ address: self.address, trackid: trackId })

      const tags = rows.map(r => r.tag)
      const idx = tags.indexOf(tag)
      if (idx === -1) {
        throw new Error('tag does not exist')
      }
      tags.splice(idx, 1)

      const tracks = await self._db('tracks')
        .innerJoin('entries', 'tracks.id', 'entries.key')
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')
        .where('tracks.address', self.address)
        .andWhere('id', trackId)
        .limit(1)

      if (!tracks.length) {
        throw new Error('track does not exist')
      }

      const { cid } = tracks[0]
      const dagNode = await self._ipfs.dag.get(CID.asCID(cid) || CID.parse(cid))
      const content = dagNode.value
      const log = self.log.mine()
      const entry = await log.tracks.put(content, tags)
      const track = await self.tracks._entryToTrack(entry, log.address.toString())
      return track
    }
  }
}
