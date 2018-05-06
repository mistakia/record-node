const RecordNode = require('./index')
const path = require('path')
const os = require('os')
const Logger  = require('logplease')
const debug = require('debug')

debug.enable('record:*,jsipfs')

Logger.setLogLevel(Logger.LogLevels.DEBUG)

const tmpDataPath = os.tmpdir()

const node = new RecordNode({
  ipfsConfig: {
    repo: path.resolve(tmpDataPath, './ipfs')
  },
  orbitPath: path.resolve(tmpDataPath, './orbitdb')
})

node.on('ready', function() {
  //ready
})
