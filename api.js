const express = require('express')
const morgan = require('morgan-debug')
const bodyParser = require('body-parser')
const extend = require('deep-extend')

const logsRouter = require('./routes/logs')
const infoRouter = require('./routes/info')
const resolveRouter = require('./routes/resolve')

const defaults = {
  port: 3000
}

module.exports = (self) => {
  const app = express()

  const options = extend(defaults, self._options.api)

  app.locals.orbitdb = self._orbitdb
  app.locals.ipfs = self._ipfs
  app.locals.log = self._log
  app.locals.loadLog = self.loadLog.bind(self)
  app.locals.resolve = self.resolve
  app.locals.info = self.info

  app.use(morgan('record:node:api', 'combined'))
  app.use(bodyParser.json())

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
  })

  app.use('/logs', logsRouter)
  app.use('/info', infoRouter)
  app.use('/resolve', resolveRouter)

  const { port } = options
  app.listen(port, () => self.logger(`API listening on port ${port}`))

  return app
}
