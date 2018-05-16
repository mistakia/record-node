const RecordNode = require('../index')
const debug = require('debug')
const Logger  = require('logplease')

debug.enable('record:*,jsipfs')

Logger.setLogLevel(Logger.LogLevels.DEBUG)

const node = new RecordNode()

node.on('ready', () => {
  //ready
})
