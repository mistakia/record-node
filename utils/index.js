const isLocal = (ipfs, cid) => new Promise((resolve, reject) => {
  ipfs._repo.blocks.has(cid, (err, exists) => {
    if (err) reject(err)
    resolve(exists)
  })
})

exports.generateAvatar = require('./generate-avatar')
exports.isLocal = isLocal
