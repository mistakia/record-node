const Libp2p = require('libp2p')
const Bootstrap = require('libp2p-bootstrap')

const { RecordStore } = require('./store')

const libp2p = ({ libp2pOptions }) => {
  libp2pOptions.modules.peerDiscovery.push(Bootstrap)
  libp2pOptions.config.peerDiscovery = {
    bootstrap: {
      list: [
        '/ip4/206.189.77.125/tcp/4001/p2p/QmaczBJVeEn9sVmkNMD7aqXg8TYeVW57JbybhacazgsfgF'
      ]
    }
  }
  libp2pOptions.config.Addresses = {
    Swarm: [
      '/ip4/0.0.0.0/tcp/4002/',
      '/ip4/0.0.0.0/tcp/4003/ws/'
    ]
  }
  return new Libp2p(libp2pOptions)
}

module.exports = {
  id: undefined,
  api: false,
  address: 'record',
  keystore: './keystore',
  cache: './cache',
  gcInterval: 10000000, // 10mb
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
    preload: {
      enabled: false
    },
    libp2p
  }
}
