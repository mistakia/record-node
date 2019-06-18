const Room = require('ipfs-pubsub-room')

module.exports = function peers (self) {
  return {
    _topic: 'RECORD',
    _index: {},
    _init: () => {
      self._room = Room(self._ipfs, self.peers._topic, self._options.pubsubRoom)
      self._room.on('peer joined', self.peers._onJoin)
      self._room.on('peer left', self.peers._onLeave)
      self._room.on('message', self.peers._onMessage)
      self._room.on('error', (e) => self.logger.err(e))
    },
    _stop: async () => {
      await self._room.leave()
    },
    get: (contactId) => {
      const peerIds = Object.keys(self.peers._index)
      const peers = peerIds.map(peerId => self.peers._index[peerId])
      return peers.find(p => p._id === contactId)
    },
    list: async () => {
      const peerIds = Object.keys(self.peers._index)
      let peers = []
      for (const peerId of peerIds) {
        const about = self.peers._index[peerId]
        const contact = await self.contacts.get({
          logId: self.address,
          contactId: about._id,
          contactAddress: about.content.address
        })
        peers.push(contact)
      }

      return peers
    },
    _onJoin: async (peer) => {
      const about = await self.about.get(self.address)
      const message = Buffer.from(JSON.stringify(about))
      self._room.sendTo(peer, message)
    },
    _onLeave: (peerId) => {
      const { address } = self.peers._index[peerId].content
      delete self.peers._index[peerId]
      const peerCount = Object.keys(self.peers._index).length
      self.logger.log(`Record peer left, remaining: ${peerCount}`)
      self.emit('redux', {
        type: 'PEER_LEFT',
        payload: { logId: address, peerCount }
      })
    },
    _onMessage: async (message) => {
      try {
        const about = JSON.parse(message.data)
        const { address } = about.content
        if (!address) {
          throw new Error('peer message missing address')
        }

        if (self.isValidAddress(address)) {
          self.peers._index[message.from] = about
        }
        const peerCount = Object.keys(self.peers._index).length
        self.logger.log(`Record peer added, current count: ${peerCount}`)
        self.emit('redux', {
          type: 'PEER_JOINED',
          payload: { logId: address, peerCount }
        })
      } catch (e) {
        self.logger.err(e)
      }
    }
  }
}
