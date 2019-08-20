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
const { CID } = require('ipfs')

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
      self.logger(`Generated AcoustID Fingerprint`)

      const log = self.log.mine()
      const id = await sha256(acoustid.fingerprint)
      const exists = await log.tracks.getFromId(id)
      if (exists) {
        return exists
      }

      const metadata = await musicMetadata.parseFile(filepath)
      const pictures = metadata.common.picture
      delete metadata.common.picture

      const extension = path.extname(filepath)
      const filename = path.parse(filepath).name
      const processPath = path.resolve(os.tmpdir(), `${filename}-notags${extension}`)
      await removeTags(filepath, processPath)
      const audioFile = await self._ipfs.addFromFs(processPath)
      await fsPromises.unlink(processPath)

      const promises = pictures ? pictures.map(p => self._ipfs.add(p.data)) : []
      const results = await Promise.all(promises)

      const trackData = {
        hash: new CID(audioFile[0].hash),
        tags: {
          ...metadata.common,
          acoustid_fingerprint: acoustid.fingerprint
        },
        audio: metadata.format,
        artwork: results.map(r => new CID(r[0].hash)),
        resolver: []
      }

      if (resolverData) {
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

    addTrackFromCID: async (cid, { logId }) => {
      const dagNode = await self._ipfs.dag.get(cid, { resolveLocal: true })
      const content = dagNode.value
      return self.tracks.add(content, { logId })
    },

    add: async (trackData, { logId } = {}) => {
      const log = await self.log.get(logId)
      const track = await log.tracks.findOrCreate(trackData)
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

    remove: async (trackId) => {
      const log = self.log.mine()
      const hash = await log.tracks.del(trackId)
      return hash
    },

    list: async (logId, opts) => {
      const log = await self.log.get(logId, { replicate: false })
      let entries = await log.tracks.all(opts)

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
