const os = require('os')
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')

const peek = require('buffer-peek-stream')
const fileType = require('file-type')
const fetch = require('node-fetch')
const fpcalc = require('fpcalc')
const ffmpeg = require('fluent-ffmpeg')
const musicMetadata = require('music-metadata')

const { sha256, formatMetadataAudio, formatMetadataTags } = require('../utils')

const orderByTrackIds = (array, trackIds) => {
  array.sort((a, b) => {
    if (trackIds.indexOf(a.key) > trackIds.indexOf(b.key)) {
      return 1
    } else {
      return -1
    }
  })

  return array
}

const getAcoustID = (filepath, options) => {
  return new Promise((resolve, reject) => {
    fpcalc(filepath, options, (err, result) => {
      if (err) return reject(err)
      resolve(result)
    })
  })
}

const removeTags = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputPath)
      .outputOptions([
        '-map 0:a', // copy only audio (removes album art)
        '-codec:a copy', // no encoding
        '-bitexact', // prevent ffmpeg from writer encoder tag
        '-map_metadata -1' // clear metadata
      ])
      .output(outputPath)
      .on('error', reject)
      .on('end', resolve)
      .run()
  })
}

const downloadFile = (resolverData) => {
  return new Promise((resolve, reject) => {
    let filepath
    fetch(resolverData.url).then(res => {
      if (!res.ok) {
        return reject(new Error(`unexpected status code: ${res.status} - ${resolverData.url}`))
      }

      const peekBytes = 4100
      peek(res.body, peekBytes, async (err, chunk, outputStream) => {
        if (err) {
          return reject(err)
        }

        const type = await fileType.fromBuffer(chunk)
        const filename = `${resolverData.extractor}-${resolverData.id}.${type.ext}`
        filepath = path.resolve(os.tmpdir(), filename)
        const file = fs.createWriteStream(filepath)
        file.on('error', (error) => reject(error))
        file.on('finish', () => {
          resolve(filepath)
        })
        outputStream.pipe(file)
      })
    }).catch(async (err) => {
      if (filepath) {
        await fsp.unlink(filepath)
      }
      reject(err)
    })
  })
}

module.exports = function tracks (self) {
  return {
    _init: () => {
      if (self._options.ffmpegPath) {
        self.logger.info(`[node] set ffmpeg path: ${self._options.ffmpegPath}`)
        ffmpeg.setFfmpegPath(self._options.ffmpegPath)
      }
    },
    _getIndexInfo: async (trackId) => {
      const tracks = await self._db('tracks')
        .innerJoin('entries', 'tracks.id', 'entries.key')
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .where({ id: trackId })
        .andWhere('entries.address', self.address)

      const tags = await self._db('tags')
        .where({ trackid: trackId })

      return { tracks, tags }
    },
    _entryToTrack: async (entry, address = self.address) => {
      const indexInfo = await self.tracks._getIndexInfo(entry.payload.key)

      const haveTrack = !!indexInfo.tracks.length
      if (!self.isMe(address) && haveTrack) {
        const log = self.log.mine()
        entry = await log.getEntryWithContent(indexInfo.tracks[0].hash)
      }

      const selfTags = []
      const externalTags = []
      for (const { address, tag } of indexInfo.tags) {
        if (address === self.address) {
          selfTags.push({ address, tag })
        } else {
          externalTags.push({ address, tag })
        }
      }
      const tags = selfTags.concat(externalTags)

      entry.payload.value.haveTrack = haveTrack
      entry.payload.value.tags = tags

      const count = await self.listens.getCount(entry.payload.value.id)
      entry.payload.value.listens = count.timestamps

      // TODO (low) - re-enable
      /* const cid = CID.parse(entry.payload.value.content.hash)
       * entry.payload.value.isLocal = await self._ipfs.repo.has(cid)
       */
      return entry.payload.value
    },

    addTracksFromFS: async (filepath, { address } = {}) => {
      self.logger.info(`[node] searching ${filepath} for tracks`)

      let result = []
      const stat = await fsp.stat(filepath)

      if (stat.isFile()) {
        try {
          const track = await self.tracks.addTrackFromFile(filepath, { address })
          result.push(track)
        } catch (e) {
          self.logger.error(e)
        }
        return result
      }

      if (stat.isDirectory()) {
        const pathsInDir = await fsp.readdir(filepath)
        self.logger.info(`[node] found ${pathsInDir.length} paths in ${filepath}`)
        for (let i = 0; i < pathsInDir.length; i++) {
          const tracks = await self.tracks.addTracksFromFS(
            path.resolve(filepath, pathsInDir[i]),
            { address }
          )
          result = tracks.concat(result)
        }
      }

      return result
    },
    addTrackFromFile: async (filepath, { resolverData, address } = {}) => {
      self.logger.info(`[node] adding track from ${filepath}`)
      const acoustid = await getAcoustID(filepath, {
        command: self._options.chromaprintPath
      })
      self.logger.info('[node] generated AcoustID Fingerprint')

      const id = sha256(acoustid.fingerprint)

      // check if already in this log, give that entry priority for now
      // TODO (low) use existing entry if possible, prioritze own log over others
      const entry = await self.tracks.get({ address, trackId: id })
      if (entry) {
        return entry
      }

      // TODO (low) - move to worker thread
      const metadata = await musicMetadata.parseFile(filepath)
      const pictures = metadata.common.picture
      delete metadata.common.picture
      self.logger.info('[node] extracted metadata')

      const extension = path.extname(filepath)
      const filename = path.parse(filepath).name
      const processPath = path.resolve(os.tmpdir(), `${filename}-notags${extension}`)
      await removeTags(filepath, processPath)
      self.logger.info('[node] cleanded file tags')

      const audioFile = await self._ipfs.add(fs.createReadStream(processPath))
      await fsp.unlink(processPath)
      self.logger.info('[node] added audio to ipfs')

      const results = []
      if (pictures) {
        for await (const file of self._ipfs.addAll(pictures.map(p => p.data))) {
          results.push(file)
        }
      }
      self.logger.info('[node] added artwork to ipfs')

      const { size } = await self._ipfs.files.stat(`/ipfs/${audioFile.cid.toString()}`, { size: true })

      const trackData = {
        size,
        hash: audioFile.cid,
        tags: formatMetadataTags({ metadata, acoustid }),
        audio: formatMetadataAudio({ metadata }),
        artwork: results.map(r => r.cid),
        resolver: []
      }

      await self._ipfs.pin.add(trackData.hash) // pin audio file
      for (let i = 0; i < trackData.artwork.length; i++) {
        await self._ipfs.pin.add(trackData.artwork[i]) // pin artwork
      }

      if (resolverData) {
        delete resolverData.url
        trackData.resolver = [resolverData]
      }

      return self.tracks.add(trackData, [], { address })
    },

    addTrackFromUrl: async (resolverData, { address = self.address } = {}) => {
      if (typeof resolverData === 'string') {
        self.logger.info(`[node] adding track from URL: ${resolverData}`)
        resolverData = await self.resolve(resolverData)
      }

      if (!resolverData) {
        return null
      }

      if (!Array.isArray(resolverData)) {
        resolverData = [resolverData]
      }

      const log = self.log.mine()
      const entries = []
      for (const item of resolverData) {
        const { extractor, id } = item
        // TODO (low) - use existing entry
        const rows = await self._db('tracks')
          .innerJoin('entries', 'tracks.id', 'entries.key')
          .innerJoin('resolvers', 'entries.key', 'resolvers.trackid')
          .where({ extractor })
          .andWhere('tracks.address', address)
          .andWhere('resolvers.id', id)
          .limit(1)

        if (rows.length) {
          const { hash } = rows[0]
          const entry = await log.getEntryWithContent(hash)

          if (entry) {
            entries.push(await self.tracks._entryToTrack(entry))
            continue
          }
        }

        const filepath = await downloadFile(item)
        // TODO (low) - hand off to importer
        entries.push(await self.tracks.addTrackFromFile(filepath, { resolverData: item, address }))
      }

      return entries
    },

    addTrackFromCID: async (cid, { address } = {}) => {
      self.logger.info(`[node] adding track from cid: ${cid}`)
      const dagNode = await self._ipfs.dag.get(cid)
      const content = dagNode.value
      return self.tracks.add(content, { address })
    },

    add: async (trackData, { address } = {}) => {
      const log = await self.log.get(address)
      const entry = await log.tracks.put(trackData, [])
      const track = await self.tracks._entryToTrack(entry, log.address.toString())
      return track
    },

    get: async ({ address = self.address, trackId }) => {
      const rows = await self._db('tracks')
        .innerJoin('entries', 'tracks.id', 'entries.key')
        .where({ key: trackId, type: 'track' })
        .andWhere('tracks.address', address)
        .orderBy('clock', 'desc')
        .orderBy('timestamp', 'desc')
        .limit(1)

      if (!rows.length) {
        return null
      }

      const { hash } = rows[0]
      const log = await self.log.get(address, { replicate: false })
      const entry = await log.getEntryWithContent(hash)

      if (!entry) {
        // TODO (low) handle / repair index
        self.logger.info(`[node] ${address} missing ${hash}`)
        return null
      }

      return self.tracks._entryToTrack(entry, address)
    },

    has: async (address, trackId) => {
      const rows = await self._db('tracks')
        .where({ address, id: trackId })
        .limit(1)

      return !!rows.length
    },

    remove: async (trackId, { address = self.address } = {}) => {
      const has = await self.tracks.has(address, trackId)
      if (!has) {
        throw new Error(`track does not exist: ${trackId}`)
      }

      self.logger.info(`[node] removing track: ${trackId}`)
      const log = await self.log.get(address)
      const hash = await log.tracks.del(trackId)
      return hash
    },

    list: async ({
      addresses = [],
      start = 0,
      shuffle = false,
      query = null,
      tags = [],
      limit = 20,
      sort = null,
      order = null
    } = {}) => {
      if (addresses && !Array.isArray(addresses)) {
        addresses = [addresses]
      }

      if (tags && !Array.isArray(tags)) {
        tags = [tags]
      }

      let sql = self._db('tracks')
        .offset(start)
        .limit(limit)

      if (tags.length) {
        let tagsSQL = self._db('tags')
          .whereIn('tag', tags)
          .groupBy('trackid')
          .havingRaw('count(tags.trackid) = ?', tags.length)

        if (addresses.length) {
          tagsSQL = tagsSQL.whereIn('address', addresses)
        }

        const tagRows = await tagsSQL
        const trackIds = tagRows.map(t => t.trackid)
        sql = sql.whereIn('tracks.id', trackIds)
      }

      if (addresses.length) {
        sql = sql.whereIn('tracks.address', addresses)
      }

      if (query) {
        const searchTerm = `%${query}%`
        sql = sql.leftJoin('resolvers', 'tracks.id', 'resolvers.trackid')
          .where(function () {
            this.orWhere('title', 'like', searchTerm)
            this.orWhere('artist', 'like', searchTerm)
            this.orWhere('album', 'like', searchTerm)
            this.orWhere('remixer', 'like', searchTerm)
            this.orWhere('fulltitle', 'like', searchTerm)
          })
      }

      let entryRows
      if (shuffle || (order && sort)) {
        if (shuffle) {
          sql = sql.orderByRaw('RANDOM()')
        } else {
          // TODO (high) validate sort
          // TODO (high) validate order
          if (sort === 'title') {
            sql = sql.leftJoin('resolvers', 'tracks.id', 'resolvers.trackid')
              .orderByRaw(`COALESCE(title, fulltitle) COLLATE NOCASE ${order}`)
          } else {
            sql = sql.orderByRaw(`${sort} COLLATE NOCASE ${order}`)
          }
        }

        const rows = await sql.select('tracks.id')
        const trackIds = rows.map(t => t.id)
        entryRows = await self._db('entries')
          .whereIn('key', trackIds)
          .orderBy('clock', 'desc')
          .orderBy('timestamp', 'desc')
          .groupBy('key')

        entryRows = orderByTrackIds(entryRows, trackIds)
      } else {
        entryRows = await sql.innerJoin('entries', 'tracks.id', 'entries.key')
          .orderBy('clock', 'desc')
          .orderBy('timestamp', 'desc')
          .groupBy('key')
      }

      const entries = []
      for (const row of entryRows) {
        const log = await self.log.get(row.address, { replicate: false })
        const entry = await log.getEntryWithContent(row.hash)
        // TODO - investigate issue where entry is undefined
        if (entry) entries.push(entry)
      }

      const tracks = []
      for (const entry of entries) {
        const track = await self.tracks._entryToTrack(entry, entry.id)
        tracks.push(track)
      }

      return tracks
    }
  }
}
