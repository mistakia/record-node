const path = require('path')
const os = require('os')

const { RecordStore } = require('./store')
const { version } = require('./package.json')

const IS_TEST = process.env.NODE_ENV === 'test'
const NOOP = () => {}

module.exports = {
  version,
  id: undefined,
  api: false,
  address: 'record',
  directory: path.resolve(os.homedir(), './.record'),
  gcInterval: 10000000, // 10mb
  chromaprintPath: null,
  ffmpegPath: null,
  youtubedlPath: null,
  logger: {
    info: IS_TEST ? NOOP : console.log,
    error: IS_TEST ? NOOP : console.error,
    stream: IS_TEST ? NOOP : process.stdout
  },
  importer: {
    enabled: false,
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
