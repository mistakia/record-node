const Bitboot = require('bitboot')
const net = require('net')

module.exports = function bootstrap (self) {
  return {
    _peers: new Map(),
    init: () => {
      if (!self._options.bitboot.enabled) {
        return
      }

      self.bootstrap._server = net.createServer(async (socket) => {
        const identity = await self._ipfs.id()
        socket.write(identity.id)
        socket.pipe(socket)
      })

      self.bootstrap._server.listen(8383, '0.0.0.0')

      self.bb = new Bitboot('record')
      self.bb.on('error', self.logger.err)
      self.bb.on('peers', async (peers) => {
        // check for new peers
        for (const peer of peers) {
          const id = peer.id.toString('hex')
          if (!self.bootstrap._peers.has(id)) {
            self.logger('Found Bitboot node: ', id)
            const client = net.createConnection({ port: 8383, host: peer.host })
            client.on('error', err => self.logger.err(err))
            client.on('data', (peerId) => {
              client.end()

              const nodeId = peerId.toString()
              if (!self._ipfs.util.isIPFS.multihash(nodeId)) {
                self.logger.err('Bitboot node peerId is invalid:', nodeId)
                return
              }

              self.logger('Connecting to Bitboot node peerId: ', nodeId)
              const addr = self._ipfs.types.multiaddr(`/ip4/${peer.host}/tcp/4002/ipfs/${peerId}`)
              self._ipfs.swarm.connect(addr, self.logger.err)
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
