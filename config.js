const Libp2p = require('libp2p')
const path = require('path')
const os = require('os')
const Stardust = require('libp2p-stardust')

const { RecordStore } = require('./store')

const libp2p = ({ libp2pOptions }) => {
  libp2pOptions.modules.transport.push(Stardust)
  libp2pOptions.config.pubsub = {
    enabled: true,
    emitSelf: true,
    signMessages: true,
    strictSigning: true
  }
  return new Libp2p(libp2pOptions)
}

module.exports = {
  id: undefined,
  api: false,
  address: 'record',
  directory: path.resolve(os.homedir(), './.record'),
  gcInterval: 10000000, // 10mb
  chromaprintPath: null,
  pubsubRoom: {
    pollInterval: 5000
  },
  store: {
    type: RecordStore.type,
    referenceCount: 24,
    replicationConcurrency: 128,
    localOnly: false,
    create: false,
    overwrite: true,
    replicate: true
  },
  bitboot: {
    enabled: true
  },
  orbitdb: {
    directory: undefined
  },
  ipfs: {
    init: {
      bits: 2048,
      emptyRepo: true
    },
    config: {
      Addresses: {
        Swarm: [
          '/ip4/0.0.0.0/tcp/4003/ws',
          '/ip4/206.189.77.125/tcp/5892/ws/p2p-stardust/p2p/QmPb9StGzfenPYnkyjpc5taLXwoC5hxdUgQub5LSi4AewA'
        ]
      },
      Bootstrap: []
    },
    preload: {
      enabled: false
    },
    libp2p
  }
}
