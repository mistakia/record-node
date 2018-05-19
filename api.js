const express = require('express')
const morgan = require('morgan-debug')
const debug = require('debug')

const ipfsRouter = require('./routes/ipfs')
const logsRouter = require('./routes/logs')

module.exports = (self) => {
  const app = express()

  app.locals.orbitdb = self._orbitdb
  app.locals.ipfs = self._ipfs
  app.locals.log = self._log
  app.locals.loadContacts = self.loadContacts.bind(self)

  app.use(morgan('record:node:api', 'combined'))

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
  })

  app.use('/ipfs', ipfsRouter)
  app.use('/logs', logsRouter)
  app.get('/', async (req, res) => {
    const ipfsInfo = await req.app.locals.ipfs.id()

    res.send({
      id: req.app.locals.orbitdb.id,
      addresses: ipfsInfo.addresses
    })
  })

  return app
}
