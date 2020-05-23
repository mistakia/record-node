const connectNode = (node1, node2) => new Promise((resolve, reject) => {
  setTimeout(() => reject(new Error('peer timed out')), 25000)

  node1.on('redux', ({ type, payload }) => {
    if (type === 'RECORD_PEER_JOINED' && payload.address === node2.address) {
      resolve()
    }
  })

  node2._ipfs.id().then((identity) => {
    node1._ipfs.swarm.connect(identity.addresses[0])
  })
})

module.exports = connectNode
