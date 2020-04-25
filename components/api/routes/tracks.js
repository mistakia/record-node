const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals
    const { start, limit, tags, shuffle, query } = req.query
    const tracks = await record.tracks.list(logAddress, {
      start: parseInt(start, 10) || null,
      limit: parseInt(limit, 10) || null,
      tags,
      shuffle,
      query
    })
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
      const track = await record.tracks.addTrackFromCID(cid)
      return res.send(track)
    }

    if (file) {
      const track = await record.tracks.addTracksFromFS(file)
      return res.send(track)
    }

    if (url) {
      const track = await record.tracks.addTrackFromUrl(url)
      return res.send(track)
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
