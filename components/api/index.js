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

  app.use('/contacts', routes.contacts)
  app.use('/feed', routes.feed)
  app.use('/info', routes.info)
  app.use('/listens', routes.listens)
  app.use('/profile', routes.profile)
  app.use('/resolve', routes.resolve)
  app.use('/tags', routes.tags)
  app.use('/tracks', routes.tracks)

  const { port } = options
  app.listen(port, () => self.logger(`API listening on port ${port}`))

  return app
}
