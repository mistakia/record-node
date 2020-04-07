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

const getAcoustID = (filepath) => {
  return new Promise((resolve, reject) => {
    fpcalc(filepath, (err, result) => {
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

      peek(res.body, fileType.minimumBytes, (err, chunk, outputStream) => {
        if (err) {
          return reject(err)
        }

        const type = fileType(chunk)
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
    addTracksFromFS: async (filepath, { logId } = {}) => {
      self.logger(`Searching ${filepath} for tracks`)

      let result = []
      const stat = await fsPromises.stat(filepath)

      if (stat.isFile()) {
        try {
          const track = await self.tracks.addTrackFromFile(filepath, { logId })
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
            { logId }
          )
          result = tracks.concat(result)
        }
      }

      return result
    },
    addTrackFromFile: async (filepath, { resolverData, logId } = {}) => {
      self.logger(`Adding track from ${filepath}`)
      const acoustid = await getAcoustID(filepath)
      self.logger('Generated AcoustID Fingerprint')

      const log = self.log.mine()
      const id = await sha256(acoustid.fingerprint)
      const exists = await log.tracks.getFromId(id)
      if (exists) {
        return exists
      }

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

      const { size } = await self._ipfs.files.stat(`/ipfs/${cid.toString()}`, { size: true })

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

      // TODO
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

      return self.tracks.add(trackData, { logId })
    },

    addTrackFromUrl: async (resolverData, { logId } = {}) => {
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
        return entry
      }

      const filepath = await downloadFile(resolverData)
      return self.tracks.addTrackFromFile(filepath, { resolverData, logId })
    },

    addTrackFromCID: async (cid, { logId } = {}) => {
      const dagNode = await self._ipfs.dag.get(cid, { localResolve: true })
      const content = dagNode.value
      return self.tracks.add(content, { logId })
    },

    add: async (trackData, { logId } = {}) => {
      const log = await self.log.get(logId)
      const shouldPin = true
      const track = await log.tracks.findOrCreate(trackData, shouldPin)
      track.payload.value.haveTrack = true
      self.emit('redux', { type: 'TRACK_ADDED', payload: { track } })
      return track
    },

    get: async (logId, trackId) => {
      const log = await self.log.get(logId, { replicate: false })
      const entry = await log.tracks.getFromId(trackId)

      if (!entry) {
        return null
      }

      if (!self.log.isMine(log)) {
        const myLog = self.log.mine()
        const haveTrack = myLog.tracks.has(entry.payload.key)
        entry.payload.value.haveTrack = haveTrack
      } else {
        entry.payload.value.haveTrack = true
      }

      return entry.payload.value
    },

    _contactsHaveTrack: async (trackId) => {
      let result = false
      const log = self.log.mine()
      const entries = await log.contacts.all()
      const contacts = entries.map(e => e.payload.value)
      for (const contact of contacts) {
        const { address } = contact.content
        const l = await self.log.get(address)
        if (l.tracks.has(trackId)) {
          result = true
          return
        }
      }

      return result
    },

    remove: async (trackId, { logId } = {}) => {
      const log = await self.log.get(logId)
      const entry = await log.tracks.getFromId(trackId)
      const hash = await log.tracks.del(trackId)

      const contactsHaveTrack = await self.tracks._contactsHaveTrack(trackId)
      if (contactsHaveTrack) {
        return hash
      }

      // TODO check logs I have write access before unpinning

      const { content, contentCID } = entry.payload.value
      if (contentCID) {
        try {
          // TODO
          // await self._ipfs.pin.rm(contentCID)
        } catch (error) {
          self.logger.err(error)
        }
        return hash
      }

      if (CID.isCID(content)) {
        try {
          // TODO
          // await self._ipfs.pin.rm(content)
        } catch (error) {
          self.logger.err(error)
        }
        return hash
      }

      return hash
    },

    list: async (logId, opts) => {
      const log = await self.log.get(logId, { replicate: false })
      const entries = await log.tracks.all(opts)

      if (!self.log.isMine(log)) {
        const myLog = self.log.mine()
        for (const index in entries) {
          const entry = entries[index]
          const trackId = entry.payload.key
          const haveTrack = myLog.tracks.has(trackId)
          if (haveTrack) {
            entries[index] = await myLog.tracks.getFromId(trackId)
          }

          entries[index].payload.value.haveTrack = haveTrack
        }
      } else {
        entries.forEach(e => { e.payload.value.haveTrack = true })
      }

      const tracks = entries.map(e => e.payload.value)
      return tracks
    }
  }
}
