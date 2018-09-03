const Room = require('ipfs-pubsub-room')
const extend = require('deep-extend')

const defaults = {
  pollInterval: 5000
}

module.exports = function peers (self) {
  return {
    _topic: 'RECORD',
    _index: {},
    init: async () => {
      self._room = Room(self._ipfs, self.peers._topic, defaults)
      self._room.on('peer joined', self.peers._onJoin)
      self._room.on('peer left', self.peers._onLeave)
      self._room.on('message', self.peers._onMessage)
      self._room.on('error', (e) => self.logger.err(e))
    },
    list: () => {
      return Object.keys(self.peers._index).map(id => self.peers._index[id])
    },
    get: (address) => {
      return Object.keys(self.peers._index).find(id =>
        self.peers._index[id].content.address === address
      )
    },
    update: async (address) => {
      const peerId = self.peers.get(address)
      if (!peerId) {
        return
      }

      const profile = await self.profile.get(address)
      const peer = self.peers._index[peerId]
      self.peers._index[peerId] = extend(peer, profile)
    },
    _onJoin: async (peer) => {
      const profile = await self.profile.get(self.address)
      const data = extend(profile, { isMe: false })
      const message = Buffer.from(JSON.stringify(data))
      self._room.sendTo(peer, message)
    },
    _onLeave: (peer) => {
      delete self.peers._index[peer]
      const peerCount = Object.keys(self.peers._index).length
      self.logger.log(`Record peer left, remaining: ${peerCount}`)
    },
    _onMessage: async (message) => {
      try {
        const contact = JSON.parse(message.data)
        const { address } = contact.content
        if (!address) {
          return
        }

        if (self.isValidAddress(address)) {
          const profile = await self.profile.get(address)
          self.peers._index[message.from] = extend(contact, profile)
        }
        const peerCount = Object.keys(self.peers._index).length
        self.logger.log(`Record peer added, current count: ${peerCount}`)
      } catch (e) {
        self.logger.err(e)
      }
    }
  }
}
