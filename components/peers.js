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
      self._room && await self._room.leave()
    },
    get: (contactId) => {
      const peerIds = Object.keys(self.peers._index)
      const peers = peerIds.map(peerId => self.peers._index[peerId])
      return peers.find(p => p.id === contactId)
    },
    list: async () => {
      const peerIds = Object.keys(self.peers._index)
      let peers = []
      for (const peerId of peerIds) {
        const about = self.peers._index[peerId]
        const contact = await self.contacts.get({
          logId: self.address,
          contactId: about.id,
          contactAddress: about.content.address,
          peerId
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
      if (!self.peers._index[peerId]) {
        return
      }

      const { address } = self.peers._index[peerId].content
      delete self.peers._index[peerId]
      const peerCount = Object.keys(self.peers._index).length
      self.logger.log(`Record peer left, remaining: ${peerCount}`)
      self.emit('redux', {
        type: 'RECORD_PEER_LEFT',
        payload: { logId: address, peerCount, peerId }
      })
    },
    _onMessage: async (message) => {
      try {
        const about = JSON.parse(message.data)
        const { address } = about.content
        if (!address) {
          throw new Error('peer message missing address')
        }

        if (!self.isValidAddress(address)) {
          return
        }

        await self.log.get(address, { replicate: false })
        self.peers._index[message.from] = about
        const peerCount = Object.keys(self.peers._index).length
        self.logger.log(`Record peer added, current count: ${peerCount}`)
        self.emit('redux', {
          type: 'RECORD_PEER_JOINED',
          payload: { logId: address, peerCount, peerId: message.from }
        })
      } catch (e) {
        self.logger.err(e)
      }
    }
  }
}
