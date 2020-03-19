const path = require('path')

module.exports = {
  timeout: 60000,
  node1: {
    directory: path.join(__dirname, '../fixtures/node1'),
    bitboot: {
      enabled: false
    },
    ipfs: {
      repo: path.join(__dirname, '../fixtures/node1/ipfs'),
      config: {
        Addresses: {
          API: '/ip4/127.0.0.1/tcp/0',
          Swarm: ['/ip4/0.0.0.0/tcp/0'],
          Gateway: '/ip4/0.0.0.0/tcp/0'
        },
        Bootstrap: [],
        Discovery: {
          MDNS: {
            Enabled: true,
            Interval: 1
          },
          webRTCStar: {
            Enabled: false
          }
        }
      }
    }
  },
  node2: {
    directory: path.join(__dirname, '../fixtures/node2'),
    bitboot: {
      enabled: false
    },
    ipfs: {
      repo: path.join(__dirname, '../fixtures/node2/ipfs'),
      config: {
        Addresses: {
          API: '/ip4/127.0.0.1/tcp/0',
          Swarm: ['/ip4/0.0.0.0/tcp/0'],
          Gateway: '/ip4/0.0.0.0/tcp/0'
        },
        Bootstrap: [],
        Discovery: {
          MDNS: {
            Enabled: true,
            Interval: 1
          },
          webRTCStar: {
            Enabled: false
          }
        }
      }
    }
  }
}
