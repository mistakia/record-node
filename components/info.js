const async = require('async')
const promisify = require('promisify-es6')

module.exports = function info (self) {
  return promisify((callback) => {
    async.parallel({

      orbitdb: (done) => {
        // TODO: return manifest & access Controller dag objects
        done(null, {
          address: self._log.address.toString(),
          publicKey: self._log.key.getPublic('hex')
        })
      },

      ipfs: (done) => {
        self._ipfs.id(done)
      },

      peers: (done) => {
        self._ipfs.swarm.peers((err, peerInfos) => {
          if (err) { return done(err) }
          const peers = []
          peerInfos.forEach((peerInfo) => {
            peers.push({
              id: peerInfo.peer.toB58String(),
              address: peerInfo.addr.toString()
            })
          })
          done(null, peers)
        })
      },

      subs: (done) => {
        self._ipfs.pubsub.ls((err, subInfos) => {
          if (err) { return done(err) }

          let subs = {}

          async.each(subInfos, (subInfo, next) => {
            self._ipfs.pubsub.peers(subInfo, (err, peerIds) => {
              subs[subInfo] = peerIds
              next(err)
            })
          }, (err) => {
            done(err, subs)
          })
        })
      }

    }, (err, results) => {
      if (err) {
        return callback(err)
      }

      const { ipfs, peers, subs, orbitdb } = results
      callback(null, {
        ipfs,
        peers,
        subs,
        orbitdb
      })
    })
  })
}
