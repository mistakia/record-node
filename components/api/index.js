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

  app.use('/about', routes.about)
  app.use('/connect', routes.connect)
  app.use('/contact', routes.contact)
  app.use('/contacts', routes.contacts)
  app.use('/disconnect', routes.disconnect)
  app.use('/export', routes.export)
  app.use('/feed', routes.feed)
  app.use('/import', routes.import)
  app.use('/info', routes.info)
  app.use('/listens', routes.listens)
  app.use('/peers', routes.peers)
  app.use('/resolve', routes.resolve)
  app.use('/tags', routes.tags)
  app.use('/file', routes.file)
  app.use('/tracks', routes.tracks)

  /* const server = Server(app)
   * const ws = WS(server)

   * ws.on('connection', (socket) => {
   *   self.logger(socket)
   *   self.on('redux', ({ type, payload }) => socket.emit('message', { type, payload }))
   * })
   */
  const { port } = options
  return app.listen(port, () => self.logger(`API listening on port ${port}`))
}
