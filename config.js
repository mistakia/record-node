const path = require('path')
const os = require('os')

const { RecordStore } = require('./store')

module.exports = {
  id: undefined,
  api: false,
  address: 'record',
  directory: path.resolve(os.homedir(), './.record'),
  gcInterval: 10000000, // 10mb
  chromaprintPath: null,
  ffmpegPath: null,
  youtubedlPath: null,
  importer: {
    enabled: true,
    directory: null
  },
  pubsubMonitor: {
    pollInterval: 5000
  },
  store: {
    type: RecordStore.type,
    referenceCount: 24,
    replicationConcurrency: 128,
    localOnly: false,
    create: false,
    overwrite: true,
    syncLocal: true,
    replicate: true
  },
  bitboot: {
    enabled: true
  },
  orbitdb: {
    directory: undefined
  }
}
