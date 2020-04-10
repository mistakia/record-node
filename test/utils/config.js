const path = require('path')

module.exports = {
  timeout: 60000,
  node1: {
    directory: path.join(__dirname, '../fixtures/node1'),
    bitboot: {
      enabled: false
    }
  },
  node2: {
    directory: path.join(__dirname, '../fixtures/node2'),
    bitboot: {
      enabled: false
    }
  }
}
