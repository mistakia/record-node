const Bitboot = require('bitboot')
const net = require('net')

const isIPFS = require('is-ipfs')
const { multiaddr } = require('ipfs-http-client')

module.exports = function bootstrap (self) {
  return {
    _peers: new Map(),
    _stop: async () => {
      self.logger('stopping bootstrap server')
      const closeServer = () => new Promise((resolve) => {
        self.bootstrap._server.close(() => resolve())
      })
      const closeBB = () => new Promise((resolve) => {
        self.bb.destroy(() => resolve())
      })

      if (self.bootstrap._server) {
        await closeServer()
      }

      if (self.bb) {
        await closeBB()
      }
    },
    _init: () => {
      if (!self._options.bitboot.enabled) {
        return
      }

      self.logger('starting bootstrap server')

      self.bootstrap._server = net.createServer(async (socket) => {
        const identity = await self._ipfs.id()
        socket.write(identity.id)
        socket.pipe(socket)
      })

      self.bootstrap._server.listen(8383, '0.0.0.0')

      self.bb = new Bitboot('record')
      self.bb.on('error', self.logger.error)
      self.bb.on('peers', async (peers) => {
        // check for new peers
        for (const peer of peers) {
          const id = peer.id.toString('hex')
          if (!self.bootstrap._peers.has(id)) {
            self.logger('Found Bitboot node: ', id)
            const client = net.createConnection({ port: 8383, host: peer.host })
            client.on('error', err => self.logger.error(err))
            client.on('data', (peerId) => {
              client.end()

              const nodeId = peerId.toString()
              if (!isIPFS.multihash(nodeId)) {
                self.logger.error('Bitboot node peerId is invalid:', nodeId)
                return
              }

              self.logger('Connecting to Bitboot node peerId: ', nodeId)
              const addr = multiaddr(`/ip4/${peer.host}/tcp/4003/ws/ipfs/${peerId}`)
              try {
                self._ipfs.swarm.connect(addr)
              } catch (err) {
                self.logger.error(err)
              }
            })
            self.bootstrap._peers.set(id, peer)
          }
        }
      })
      self.bb.on('rejoin', (nodeId) => {
        self.logger('Bitboot node id: ', nodeId.toString('hex'))
      })
    }
  }
}
