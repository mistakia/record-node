const express = require('express')
const async = require('async')
const router = express.Router()

router.get('/?', async (req, res) => {
  async.parallel({

    orbitdb: (done) => {
      // TODO: return manifest & access Controller dag objects
      done(null, {
        address: req.app.locals.log.address.toString(),
        publicKey: req.app.locals.log.key.getPublic('hex')
      })
    },

    ipfs: (done) => {
      req.app.locals.ipfs.id(done)
    },

    peers: (done) => {
      req.app.locals.ipfs.swarm.peers((err, peerInfos) => {
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
      req.app.locals.ipfs.pubsub.ls((err, subInfos) => {
        if (err) { return done(err) }

        let subs = {}

        async.each(subInfos, (subInfo, next) => {
          req.app.locals.ipfs.pubsub.peers(subInfo, (err, peerIds) => {
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
      return res.send({ error: err })
    }

    const { ipfs, peers, subs, orbitdb } = results
    res.send({
      ipfs,
      peers,
      subs,
      orbitdb
    })
  })
})

module.exports = router
