const Record = require('../../index')

const startRecord = () => new Promise((resolve, reject) => {
  const config = {
    api: true,
    ipfs: {
      config: {
        Bootstrap: [],
        Addresses: {
          Swarm: [
            '/ip4/0.0.0.0/tcp/4002/',
            '/ip4/0.0.0.0/tcp/4003/ws/'
          ]
        }
      }
    }
  }

  const record = new Record(config)
  record.on('error', (err) => {
    reject(err)
  })

  record.on('ready', () => {
    resolve(record)
  })
})

module.exports = startRecord
