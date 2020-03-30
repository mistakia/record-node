module.exports = (node1, node2) => new Promise((resolve, reject) => {
  setTimeout(() => reject(new Error('peer timed out')), 25000)

  node1.on('redux', ({ type, payload }) => {
    if (type === 'RECORD_PEER_JOINED' && payload.logId === node2.address) {
      resolve()
    }
  })
})
