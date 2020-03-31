const Room = require('ipfs-pubsub-room')

module.exports = function peers (self) {
  return {
    _topic: 'RECORD',
    _index: {},
    _init: () => {
      self._room = new Room(self._ipfs, self.peers._topic, self._options.pubsubRoom)
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
      let peerLogs = []
      for (const peerId of peerIds) {
        peerLogs.push(self.peers._index[peerId].about)
        self.peers._index[peerId].logs.forEach(l => peerLogs.push(l))
      }
      return peerLogs.find(p => p.id === contactId)
    },
    list: async () => {
      const peerIds = Object.keys(self.peers._index)
      const peers = []
      for (const peerId of peerIds) {
        for (const about of self.peers._index[peerId].logs) {
          const contact = await self.contacts.get({
            logId: self.address,
            contactId: about.id,
            contactAddress: about.content.address,
            peerId
          })
          peers.push(contact)
        }
      }

      return peers
    },
    _onJoin: async (peer) => {
      const logIds = Object.keys(self._logs)
      const data = {
        logs: []
      }

      data.about = await self.about.get(self.address)

      for (const logId of logIds) {
        const about = await self.about.get(logId)
        data.logs.push(about)
      }
      const message = Buffer.from(JSON.stringify(data))
      self._room.sendTo(peer, message)
    },
    _onLeave: (peerId) => {
      if (!self.peers._index[peerId]) {
        return
      }

      const logs = self.peers._index[peerId].logs
      delete self.peers._index[peerId]
      const peerCount = Object.keys(self.peers._index).length
      self.logger.log(`Record peer left, remaining: ${peerCount}`)

      for (const about of logs) {
        self.emit('redux', {
          type: 'RECORD_PEER_LEFT',
          payload: { logId: about.content.address, peerCount, peerId }
        })
      }
    },
    _add: async (about, peerId) => {
      const { address } = about.content
      if (!address) {
        throw new Error('peer message missing address')
      }

      if (!self.isValidAddress(address)) {
        return
      }

      await self.log.get(address, { replicate: false })
      const peerCount = Object.keys(self.peers._index).length
      self.emit('redux', {
        type: 'RECORD_PEER_JOINED',
        payload: { logId: about.content.address, peerCount, peerId }
      })
    },
    _onMessage: async (message) => {
      try {
        const data = JSON.parse(message.data)
        self.peers._index[message.from] = data

        await self.peers._add(data.about, message.from)

        const peerCount = Object.keys(self.peers._index).length
        for (const about of data.logs) {
          await self.peers._add(about, message.from)
        }

        self.logger.log(`Record peer added, current count: ${peerCount}`)
      } catch (e) {
        self.logger.err(e)
      }
    }
  }
}
