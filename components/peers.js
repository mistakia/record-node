const PeerMonitor = require('ipfs-pubsub-peer-monitor')

module.exports = function peers (self) {
  return {
    _topic: 'RECORD',
    _index: {},
    _init: () => {
      self._monitor = new PeerMonitor(self._ipfs.pubsub, self.peers._topic, self._options.pubsubMonitor)
      self._monitor.on('join', self.peers._announceLogs)
      self._monitor.on('leave', self.peers._onLeave)
      self._monitor.on('error', (e) => self.logger.error(e))
      self._ipfs.pubsub.subscribe(self.peers._topic, self.peers._onMessage)
    },
    _stop: async () => {
      self._monitor && await self._monitor.stop()
      self._ipfs.pubsub.unsubscribe(self.peers._topic, self.peers._onMessage)
    },
    get: (logAddress) => {
      const peerIds = Object.keys(self.peers._index)
      const peerLogs = []
      for (const peerId of peerIds) {
        peerLogs.push(self.peers._index[peerId].about)
        self.peers._index[peerId].logs.forEach(l => peerLogs.push(l))
      }
      return peerLogs.find(p => p.content.address === logAddress)
    },
    list: async () => {
      const peerIds = Object.keys(self.peers._index)
      const peers = []
      const addPeer = async (about) => {
        const peerLog = await self.logs.get({
          sourceAddress: self.address,
          targetAddress: about.content.address
        })
        peers.push(peerLog)
      }

      for (const peerId of peerIds) {
        const peer = self.peers._index[peerId]
        await addPeer(peer.about)
        for (const about of peer.logs) {
          await addPeer(about)
        }
      }

      return peers
    },
    _announceLogs: async (peer) => {
      const logAddresses = Object.keys(self._logAddresses)
      const data = {
        logs: []
      }

      data.about = await self.about.get(self.address)

      for (const logAddress of logAddresses) {
        const isLocal = self.log.isLocal(logAddress)
        if (!isLocal) {
          continue
        }

        const isEmpty = await self.log.isEmpty(logAddress)
        if (isEmpty) {
          continue
        }

        const about = await self.about.get(logAddress)
        data.logs.push(about)
      }
      const message = Buffer.from(JSON.stringify(data))
      // TODO send to specific peer when available
      self._ipfs.pubsub.publish(self.peers._topic, message)
    },
    _onLeave: (peerId) => {
      if (!self.peers._index[peerId]) {
        return
      }

      const peer = self.peers._index[peerId]
      delete self.peers._index[peerId]
      const peerCount = Object.keys(self.peers._index).length
      self.logger.log(`Record peer left, remaining: ${peerCount}`)

      self.emit('redux', {
        type: 'RECORD_PEER_LEFT',
        payload: {
          logAddress: peer.about.content.address,
          peerCount,
          peerId
        }
      })

      for (const about of peer.logs) {
        self.emit('redux', {
          type: 'RECORD_PEER_LEFT',
          payload: { logAddress: about.content.address, peerCount, peerId }
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
        payload: { logAddress: address, peerCount, peerId }
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
        self.logger.error(e)
      }
    }
  }
}
