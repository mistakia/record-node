const os = require('os')
const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')

const peek = require('buffer-peek-stream')
const fileType = require('file-type')
const fetch = require('node-fetch')
const fpcalc = require('fpcalc')
const ffmpeg = require('fluent-ffmpeg')
const musicMetadata = require('music-metadata')
const { sha256 } = require('crypto-hash')
const { CID, globSource } = require('ipfs')

const { loadContentFromCID } = require('../utils')

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
        await fsPromises.unlink(filepath)
      }
      reject(err)
    })
  })
}

module.exports = function tracks (self) {
  return {
    _contentToTrack: async (content, trackId) => {
      let track = {
        id: trackId,
        tags: [],
        isLocal: false,
        haveTrack: false,
        listens: [],
        externalTags: [],
        ...content
      }

      if (!trackId) {
        return track
      }

      const log = self.log.mine()
      track.haveTrack = log.tracks.has(trackId)
      if (track.haveTrack) {
        const entry = await log.tracks.getFromId(trackId)
        track = entry.payload.value
        track.haveTrack = true
        track.externalTags = []
      }

      const count = await self.listens.getCount(trackId)
      track.listens = count.timestamps

      const cid = new CID(content.content.hash)
      track.isLocal = await self._ipfs.repo.has(cid)
      return track
    },
    _entryToTrack: async (entry, logAddress = self.address) => {
      if (!self.isMe(logAddress)) {
        const myLog = self.log.mine()
        const externalTags = entry.payload.value.tags
        const haveTrack = myLog.tracks.has(entry.payload.key)
        if (haveTrack) {
          const track = await myLog.tracks.getFromId(entry.payload.value.id)
          track.payload.value.externalTags = externalTags
          entry = track
        } else {
          entry.payload.value.externalTags = externalTags
          entry.payload.value.tags = []
        }

        entry.payload.value.haveTrack = haveTrack
      } else {
        entry.payload.value.haveTrack = true
        entry.payload.value.externalTags = []
      }

      const count = await self.listens.getCount(entry.payload.value.id)
      entry.payload.value.listens = count.timestamps

      const cid = new CID(entry.payload.value.content.hash)
      entry.payload.value.isLocal = await self._ipfs.repo.has(cid)

      return entry.payload.value
    },

    addTracksFromFS: async (filepath, { logAddress } = {}) => {
      self.logger(`Searching ${filepath} for tracks`)

      let result = []
      const stat = await fsPromises.stat(filepath)

      if (stat.isFile()) {
        try {
          const track = await self.tracks.addTrackFromFile(filepath, { logAddress })
          result.push(track)
        } catch (e) {
          self.logger.err(e)
        }
        return result
      }

      if (stat.isDirectory()) {
        const pathsInDir = await fsPromises.readdir(filepath)
        self.logger(`Found ${pathsInDir.length} paths in ${filepath}`)
        for (let i = 0; i < pathsInDir.length; i++) {
          const tracks = await self.tracks.addTracksFromFS(
            path.resolve(filepath, pathsInDir[i]),
            { logAddress }
          )
          result = tracks.concat(result)
        }
      }

      return result
    },
    addTrackFromFile: async (filepath, { resolverData, logAddress } = {}) => {
      self.logger(`Adding track from ${filepath}`)
      const acoustid = await getAcoustID(filepath, {
        command: self._options.chromaprintPath
      })
      self.logger('Generated AcoustID Fingerprint')

      const id = await sha256(acoustid.fingerprint)

      // check if already in this log, give that entry priority for now
      // TODO merge if content cid is different
      let entry = await self.tracks.get({ logAddress, trackId: id })
      if (entry) {
        return entry
      }

      // check if in other logs
      // TODO merge if content cid is different
      entry = await self.tracks.get({ trackId: id })
      if (entry) {
        return entry
      }

      // TODO - move to worker thread
      const metadata = await musicMetadata.parseFile(filepath)
      const pictures = metadata.common.picture
      delete metadata.common.picture
      self.logger('Extracted metadata')

      const extension = path.extname(filepath)
      const filename = path.parse(filepath).name
      const processPath = path.resolve(os.tmpdir(), `${filename}-notags${extension}`)
      await removeTags(filepath, processPath)
      self.logger('Cleanded file tags')

      let audioFile
      for await (const file of self._ipfs.add(globSource(processPath))) {
        audioFile = file
      }
      await fsPromises.unlink(processPath)
      self.logger('Added audio to ipfs')

      const results = []
      if (pictures) {
        for await (const file of self._ipfs.add(pictures.map(p => p.data))) {
          results.push(file)
        }
      }
      self.logger('Added artwork to ipfs')

      const { size } = await self._ipfs.files.stat(`/ipfs/${audioFile.cid.toString()}`, { size: true })

      const trackData = {
        size,
        hash: audioFile.cid,
        tags: {
          ...metadata.common,
          acoustid_fingerprint: acoustid.fingerprint
        },
        audio: metadata.format,
        artwork: results.map(r => r.cid),
        resolver: []
      }

      // TODO re-enable pinning
      /* await self._ipfs.pin.add(trackData.hash)
       * self.logger('Pinned audio')
       * for (let i = 0; i < trackData.artwork.length; i++) {
       *   await self._ipfs.pin.add(trackData.artwork[i])
       * }
       * self.logger('Pinned artwork')
       */
      if (resolverData) {
        delete resolverData.url
        trackData.resolver = [resolverData]
      }

      return self.tracks.add(trackData, { logAddress })
    },

    addTrackFromUrl: async (resolverData, { logAddress } = {}) => {
      if (typeof resolverData === 'string') {
        const results = await self.resolve(resolverData)
        resolverData = results[0]
      }

      if (!resolverData) {
        return null
      }

      const log = self.log.mine()
      const entry = await log.tracks.getFromResolverId(resolverData.extractor, resolverData.id)

      if (entry) {
        return self.tracks._entryToTrack(entry)
      }

      const filepath = await downloadFile(resolverData)
      return self.tracks.addTrackFromFile(filepath, { resolverData, logAddress })
    },

    addTrackFromCID: async (cid, { logAddress } = {}) => {
      const dagNode = await self._ipfs.dag.get(cid)
      const content = dagNode.value
      return self.tracks.add(content, { logAddress })
    },

    add: async (trackData, { logAddress } = {}) => {
      const log = await self.log.get(logAddress)
      const shouldPin = true
      const entry = await log.tracks.findOrCreate(trackData, shouldPin)
      const track = await self.tracks._entryToTrack(entry, log.address.toString())
      self.emit('redux', {
        type: 'TRACK_ADDED',
        payload: { data: track, logAddress: log.address.toString() }
      })
      return track
    },

    getFromCID: async (cid, trackId) => {
      const content = await loadContentFromCID(self._ipfs, cid, 'track')
      return self.tracks._contentToTrack(content, trackId)
    },

    get: async ({ logAddress, trackId }) => {
      if (!logAddress) {
        const localAddresses = await self.log.getLocalAddresses()
        for (const localAddress of localAddresses) {
          const track = self.tracks.get({ logAddress: localAddress, trackId })
          if (track) {
            return track
          }
        }

        return null
      }

      const log = await self.log.get(logAddress, { replicate: false })
      const entry = await log.tracks.getFromId(trackId)

      if (!entry) {
        return null
      }

      return self.tracks._entryToTrack(entry, logAddress)
    },

    _isInLinkedLogs: async (trackId) => {
      let result = false
      const log = self.log.mine()
      const entries = await log.logs.all()
      const values = entries.map(e => e.payload.value)
      for (const value of values) {
        const { address } = value.content
        const l = await self.log.get(address)
        if (l.tracks.has(trackId)) {
          result = true
          return
        }
      }

      return result
    },

    remove: async (trackId, { logAddress } = {}) => {
      const log = await self.log.get(logAddress)
      const entry = await log.tracks.getFromId(trackId)
      const hash = await log.tracks.del(trackId)

      const isInLinkedLogs = await self.tracks._isInLinkedLogs(trackId)
      if (isInLinkedLogs) {
        return hash
      }

      // TODO check logs I have write access before unpinning

      const { content, contentCID } = entry.payload.value
      if (contentCID) {
        try {
          // TODO re-enable pin removal
          // await self._ipfs.pin.rm(contentCID)
        } catch (error) {
          self.logger.err(error)
        }
        return hash
      }

      if (CID.isCID(content)) {
        try {
          // TODO re-enable pin removal
          // await self._ipfs.pin.rm(content)
        } catch (error) {
          self.logger.err(error)
        }
        return hash
      }

      return hash
    },

    list: async (logAddress, opts) => {
      const log = await self.log.get(logAddress, { replicate: false })
      const entries = await log.tracks.all(opts)

      const tracks = []
      for (const entry of entries) {
        const track = await self.tracks._entryToTrack(entry, logAddress)
        tracks.push(track)
      }

      return tracks
    }
  }
}
