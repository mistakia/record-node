const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals
    const tracks = await record.tracks.list(logAddress, req.query)
    res.send(tracks)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { url, file, cid } = req.body
    const { record } = req.app.locals

    if (cid) {
      const entry = await record.tracks.addTrackFromCID(cid)
      return res.send(entry)
    }

    if (file) {
      const entry = await record.tracks.addTrackFromFile(file)
      return res.send(entry)
    }

    if (url) {
      const entry = await record.tracks.addTrackFromUrl(url)
      return res.send(entry)
    }

    res.status(400).send({ error: 'Body missing one of \'cid\', \'url\', or \'file\'' })
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.delete('/?', async (req, res) => {
  try {
    const { trackId } = req.query
    const { record } = req.app.locals
    const hash = await record.tracks.remove(trackId)
    res.send({ trackId, hash })
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
