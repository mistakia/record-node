const express = require('express')
const morgan = require('morgan-debug')
const bodyParser = require('body-parser')
const extend = require('deep-extend')

const routes = require('./routes')

const defaults = {
  port: 3000
}

module.exports = (self) => {
  const app = express()
  const options = extend(defaults, self._options.api)

  app.locals.record = self

  app.use(morgan('record:node:api', 'combined'))
  app.use(bodyParser.json())

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
  })

  app.use('/about', routes.about) // TODO (low) move to /log
  app.use('/connect', routes.connect)
  app.use('/log', routes.log)
  app.use('/logs', routes.logs)
  app.use('/disconnect', routes.disconnect)
  app.use('/export', routes.export)
  app.use('/import', routes.import)
  app.use('/listens', routes.listens)
  app.use('/peers', routes.peers)
  app.use('/resolve', routes.resolve)
  app.use('/tags', routes.tags)
  app.use('/file', routes.file)
  app.use('/tracks', routes.tracks)
  app.use('/settings', routes.settings)
  app.use('/importer', routes.importer)

  const { port } = options
  return app.listen(port, () => self.logger(`API listening on port ${port}`))
}
