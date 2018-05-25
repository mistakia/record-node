const express = require('express')
const morgan = require('morgan-debug')
const bodyParser = require('body-parser')

const logsRouter = require('./routes/logs')
const infoRouter = require('./routes/info')
const ipfsRouter = require('./routes/ipfs')

module.exports = (self) => {
  const app = express()

  app.locals.orbitdb = self._orbitdb
  app.locals.ipfs = self._ipfs
  app.locals.log = self._log
  app.locals.loadContacts = self.loadContacts.bind(self)

  app.use(morgan('record:node:api', 'combined'))
  app.use(bodyParser.json())

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
  })

  app.use('/ipfs', ipfsRouter)
  app.use('/logs', logsRouter)
  app.use('/info', infoRouter)

  return app
}
