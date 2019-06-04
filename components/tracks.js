const os = require('os')
const fs = require('fs')
const path = require('path')

const peek = require('buffer-peek-stream')
const fileType = require('file-type')
const fetch = require('node-fetch')
const fpcalc = require('fpcalc')
const ffmpeg = require('fluent-ffmpeg')
const musicMetadata = require('music-metadata')

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
        return reject(new Error('unexpected status code: ' + res.status))
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
    }).catch(err => {
      if (filepath) fs.unlinkSync(filepath)
      reject(err)
    })
  })
}

module.exports = function tracks (self) {
  const { CID } = self._ipfs.types

  return {
    addTrackFromFile: async (filepath, resolverData = {}) => {
      self.logger(`Adding track from ${filepath}`)
      const acoustid = await getAcoustID(filepath)
      self.logger(`Generated AcoustID Fingerprint`)
      const metadata = await musicMetadata.parseFile(filepath)
      const pictures = metadata.common.picture
      delete metadata.common.picture

      const extension = metadata.format.encoder
      const processPath = path.resolve(os.tmpdir(), `${filepath.replace(extension, '')}notags.${extension}`)
      await removeTags(filepath, processPath)
      const audioFile = await self._ipfs.addFromFs(processPath)

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

      const track = await self.tracks.add(trackData)
      return track
    },

    addTrackFromUrl: async (resolverData) => {
      if (typeof resolverData === 'string') {
        const results = await self.resolve(resolverData)
        resolverData = results[0]
      }

      if (!resolverData) {
        return null
      }

      const log = await self.log.mine()
      const entry = await log.tracks.getFromResolverId(resolverData.extractor, resolverData.id)

      if (entry) {
        return entry
      }

      const filepath = await downloadFile(resolverData)
      const track = await self.tracks.addTrackFromFile(filepath, resolverData)
      return track
    },

    addTrackFromCID: async (cid) => {
      const dagNode = await self._ipfs.dag.get(cid)
      const content = dagNode.value
      return self.tracks.add(content)
    },

    add: async (trackData) => {
      const log = await self.log.mine()
      const track = await log.tracks.findOrCreate(trackData)
      return track
    },

    get: async (logId, trackId) => {
      const log = await self.log.get(logId)
      const entry = await log.tracks.getFromId(trackId)
      return entry.payload.value
    },

    remove: async (trackId) => {
      const log = await self.log.mine()
      const hash = await log.tracks.del(trackId)
      return hash
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
            entries[index] = await myLog.tracks.getFromId(trackId)
          }
        }
      }

      const tracks = entries.map(e => e.payload.value)
      return tracks
    }
  }
}
