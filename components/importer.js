const fs = require('fs')
const fsPromises = fs.promises
const path = require('path')
const jsonfile = require('jsonfile')

const fileExists = async path => !!(await fsPromises.stat(path).catch(e => false))
const walk = async (dir, {
  filelist = [],
  dirlist = [],
  onFile
} = {}) => {
  const files = await fsPromises.readdir(dir)

  for (const file of files) {
    const filepath = path.join(dir, file)
    const stat = await fsPromises.stat(filepath)

    if (stat.isDirectory()) {
      dirlist.push(filepath)
      const data = await walk(filepath, { filelist, dirlist, onFile })
      filelist = data.filelist
      dirlist = data.dirlist
    } else {
      filelist.push(filepath)
      if (onFile) onFile(filepath)
    }
  }

  return { filelist, dirlist }
}

const defaultQueue = () => ({
  jobs: {},
  files: {},
  completed: {}
})

let queue = defaultQueue()

module.exports = function importer (self) {
  return {
    _directory: null,
    _onImportDirectoryChange: (event, filepath) => {
      self.importer.add(self.importer._directory)
    },
    _cleanup: async (file) => {
      // cleanup import directory
      if (file.includes(self.importer._directory)) {
        fs.unlinkSync(file)

        const dir = path.dirname(file)
        if (dir !== self.importer._directory) {
          const { filelist } = await walk(dir)
          if (!filelist.length) {
            fs.rmdirSync(dir)
          }
        }
      }

      // cleanup jobs & emit events
      const jobIds = new Set(Object.values(queue.files).flat())
      for (const jobId of Object.keys(queue.jobs)) {
        if (!queue.jobs[jobId].queued) {
          continue
        }

        const tasksLeft = jobIds.has(jobId)
        const job = queue.jobs[jobId]
        if (!tasksLeft) {
          self.emit('redux', {
            type: 'IMPORTER_FINISHED',
            payload: {
              ...job
            }
          })

          delete queue.jobs[jobId]
        }
      }
    },
    _worker: async () => {
      const files = Object.keys(queue.files)
      if (!files.length) {
        self.importer._importing = false
        return
      }

      let track = {}
      let error
      const file = files[0]
      const jobIds = queue.files[file]

      try {
        if (queue.completed[file]) {
          const { trackId, logAddresses } = queue.completed[file]
          if (trackId && logAddresses && logAddresses.length) {
            track = self.tracks.get({ logAddress: logAddresses[0], trackId })
          }
        }

        const firstJobId = jobIds.shift()
        const firstJob = queue.jobs[firstJobId]
        if (!track.id) {
          track = await self.tracks.addTrackFromFile(file, { logAddress: firstJob.logAddress })
        } else {
          await self.tracks.addTrackFromCID(track.cid, { logAddress: firstJob.logAddress })
        }

        for (const jobId of jobIds) {
          const job = queue.jobs[jobId]
          await self.tracks.addTrackFromCID(track.cid, { logAddress: job.logAddress })
        }
      } catch (e) {
        self.logger.error(e)
        error = e
      } finally {
        const trackId = track.id
        const jobLogAddressesSet = new Set(Object.keys(queue.jobs).map(jobId => queue.jobs[jobId].logAddress))
        const jobLogAddresses = Array.from(jobLogAddressesSet)
        if (queue.completed[file]) {
          if (error) {
            queue.completed[file].error = error
          }

          if (Array.isArray(queue.completed[file].logAddresses)) {
            queue.completed[file].logAddresses = queue.completed[file].logAddresses.concat(jobLogAddresses)
          } else {
            queue.completed[file].logAddresses = jobLogAddresses
          }
        } else {
          queue.completed[file] = { error, trackId, logAddresses: jobLogAddresses }
        }
        delete queue.files[file]
        jsonfile.writeFileSync(self.importer._queuePath, queue, { spaces: 2 })

        self.emit('redux', {
          type: 'IMPORTER_PROCESSED_FILE',
          payload: {
            file,
            trackId,
            track,
            logAddresses: jobLogAddresses,
            completed: Object.keys(queue.completed).length,
            remaining: Object.keys(queue.files).length
          }
        })

        await self.importer._cleanup(file)
        self.importer._worker()
      }
    },
    start: () => {
      if (!self.importer._importing) {
        self.importer._importing = true
        self.importer._worker()
      }
    },
    watch: async () => {
      const directory = self.importer._directory
      const dirExists = await fileExists(directory)
      if (!dirExists) {
        await fsPromises.mkdir(directory)
      }
      self.importer._watcher = fs.watch(directory, self.importer._onImportDirectoryChange)
    },
    add: async (filepath, logAddress = self.address) => {
      const jobId = `${logAddress}${filepath}`
      queue.jobs[jobId] = {
        queued: false,
        filepath,
        logAddress
      }

      const onFile = (file) => {
        if (queue.completed[file]) {
          const { logAddresses, error } = queue.completed[file]

          if (error) {
            return
          }

          if (logAddresses && logAddresses.includes(logAddress)) {
            return
          }
        }

        if (queue.files[file]) {
          const jobIds = queue.files[file]
          if (!jobIds.includes(jobId)) {
            queue.files[file] = queue.files[file].push(jobId)
          }
        } else {
          queue.files[file] = [jobId]
        }

        self.importer.start()
      }

      const stat = await fsPromises.stat(filepath)
      if (stat.isDirectory()) {
        await walk(filepath, { onFile })
      } else {
        onFile(filepath)
      }

      queue.jobs[jobId].queued = true
      jsonfile.writeFileSync(self.importer._queuePath, queue, { spaces: 2 })
    },
    list: () => {
      const files = Object.keys(queue.files)
      return { files }
    },
    setDirectory: async (filepath) => {
      if (!path.isAbsolute(filepath)) {
        throw new Error(`${filepath} is not absolute.`)
      }

      self.importer._directory = filepath
      if (self.importer._watcher) self.importer._watcher.stop()
      await self.importer.watch()
      return self.importer._directory
    },
    init: async () => {
      self.importer._queuePath = path.resolve(self._options.directory, './queue.json')
      const queueExists = await fileExists(self.importer._queuePath)
      if (queueExists) {
        queue = jsonfile.readFileSync(self.importer._queuePath)
        self.importer.start()
      } else {
        queue = defaultQueue()
      }

      if (!self._options.importer.enabled) {
        return
      }

      const defaultDir = path.resolve(self._options.directory, './import')
      self.importer._directory = self._options.importer.directory || defaultDir

      await self.importer.watch()
    }
  }
}
