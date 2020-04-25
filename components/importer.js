const fs = require('fs').promises
const path = require('path')
const jsonfile = require('jsonfile')

const fileExists = async path => !!(await fs.stat(path).catch(e => false))
const walk = async (dir, {
  filelist = [],
  dirlist = [],
  onFile
} = {}) => {
  const files = await fs.readdir(dir)

  for (const file of files) {
    const filepath = path.join(dir, file)
    const stat = await fs.stat(filepath)

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
        const { filelist } = await walk(dir)
        if (!filelist.length) {
          fs.rmdirSync(dir)
        }
      }

      // cleanup jobs & emit events
      const jobs = new Set(Object.values(queue.files).flat())
      for (const job of Object.keys(queue.jobs)) {
        // ignore if still queueing files
        if (!queue.jobs[job]) {
          continue
        }

        const tasksLeft = jobs.has(job)
        if (!tasksLeft) {
          delete queue.jobs[job]

          self.emit('redux', {
            type: 'IMPORTER_FINISHED',
            payload: {
              file: job
            }
          })
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

      try {
        track = await self.tracks.addTrackFromFile(file)
      } catch (e) {
        self.logger.err(e)
        error = e
      } finally {
        const trackId = track.id
        queue.completed[file] = { error, trackId }
        delete queue.files[file]
        jsonfile.writeFileSync(self.importer._queuePath, queue, { spaces: 2 })

        self.emit('redux', {
          type: 'IMPORTER_PROCESSED_FILE',
          payload: {
            file,
            trackId,
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
    add: async (filepath) => {
      queue.jobs[filepath] = false

      const onFile = (file) => {
        if (queue.files[file]) {
          queue.files[file] = queue.files[file].push(filepath)
        } else {
          queue.files[file] = [filepath]
        }

        self.importer.start()
      }

      const stat = await fs.stat(filepath)
      if (stat.isDirectory()) {
        await walk(filepath, { onFile })
      } else {
        onFile(filepath)
      }

      queue.jobs[filepath] = true
    },
    setDirectory: (filepath) => {
      if (!path.isAbsolute(filepath)) {
        throw new Error(`${filepath} is not absolute.`)
      }

      self.importer._directory = filepath
      self.improter._watcher.stop()
      self.importer.init()
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

      if (!self._options.importer.directory) {
        return
      }

      const directory = self.importer._directory = self._options.importer.directory
      const dirExists = await fileExists(directory)
      if (!dirExists) {
        await fs.mkdir(directory)
      }
      self.importer._watcher = fs.watch(directory, self.importer._onImportDirectoryChange)
    }
  }
}
