const { RecordStore } = require('./store')

module.exports = {
  id: undefined,
  api: false,
  address: 'record',
  keystore: './keystore',
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
    // repo: path.resolve(recorddir, './ipfs'),
    EXPERIMENTAL: {
      dht: false, // TODO: BRICKS COMPUTER
      pubsub: true
    },
    config: {
      Bootstrap: [],
      Addresses: {
        Swarm: [
          // '/ip4/0.0.0.0/tcp/4002/',
          '/ip4/0.0.0.0/tcp/4003/ws/',
          '/ip4/206.189.77.125/tcp/9090/ws/p2p-websocket-star/'
        ]
      }
    },
    libp2p: {
      config: {
        relay: {
          enabled: true,
          hop: {
            enabled: true,
            active: true
          }
        }
      }
    },
    connectionManager: {
      maxPeers: 100,
      minPeers: 10,
      pollInterval: 60000 // ms
    }
  }
}
