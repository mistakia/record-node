const PeerMonitor = require('ipfs-pubsub-peer-monitor')

module.exports = function peers (self) {
  return {
    _topic: 'RECORD',
    _index: {},
    _init: () => {
      self.logger.info('[node] initializing peer monitor')
      self._monitor = new PeerMonitor(self._ipfs.pubsub, self.peers._topic, self._options.pubsubMonitor)
      self._monitor.on('join', self.peers._announceLogs)
      self._monitor.on('leave', self.peers._onLeave)
      self._monitor.on('error', (e) => self.logger.error(e))
      self._ipfs.pubsub.subscribe(self.peers._topic, self.peers._onMessage)
    },
    _stop: async () => {
      self.logger.info('[node] stop peer monitor')
      self._monitor && await self._monitor.stop()
      self._ipfs.pubsub.unsubscribe(self.peers._topic, self.peers._onMessage)
    },
    get: (address) => {
      const peerIds = Object.keys(self.peers._index)
      const peerLogs = []
      for (const peerId of peerIds) {
        peerLogs.push(self.peers._index[peerId].about)
        self.peers._index[peerId].logs.forEach(l => peerLogs.push(l))
      }
      return peerLogs.find(p => p.content.address === address)
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
      const addresses = Object.keys(self._addresses)
      const data = {
        logs: []
      }

      data.about = await self.about.get(self.address)

      for (const address of addresses) {
        const isLocal = self.log.isLocal(address)
        if (!isLocal) {
          continue
        }

        const isEmpty = await self.log.isEmpty(address)
        if (isEmpty) {
          continue
        }

        const about = await self.about.get(address)
        data.logs.push(about)
      }
      const message = JSON.stringify(data)
      // TODO (low) send to specific peer when available
      self._ipfs.pubsub.publish(self.peers._topic, message)
    },
    _onLeave: (peerId) => {
      if (!self.peers._index[peerId]) {
        return
      }

      const peer = self.peers._index[peerId]
      delete self.peers._index[peerId]
      const peerCount = Object.keys(self.peers._index).length
      self.logger.info(`[node] record peer left, remaining: ${peerCount}`)

      self.emit('redux', {
        type: 'RECORD_PEER_LEFT',
        payload: {
          address: peer.about.content.address,
          peerCount,
          peerId
        }
      })

      for (const about of peer.logs) {
        self.emit('redux', {
          type: 'RECORD_PEER_LEFT',
          payload: { address: about.content.address, peerCount, peerId }
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
        payload: { address: address, peerCount, peerId }
      })
    },
    _onMessage: async (message) => {
      try {
        const str = Buffer.from(message.data).toString()
        const data = JSON.parse(str)
        self.peers._index[message.from] = data

        await self.peers._add(data.about, message.from)

        const peerCount = Object.keys(self.peers._index).length
        for (const about of data.logs) {
          try {
            await self.peers._add(about, message.from)
          } catch (e) {
            self.logger.error(e)
          }
        }

        self.logger.info(`[node] record peer added, current count: ${peerCount}`)
      } catch (e) {
        self.logger.error(e)
      }
    }
  }
}
