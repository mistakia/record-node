const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { record } = req.app.locals
    const { start, limit, tags, shuffle, query, sort, order, addresses } = req.query
    const tracks = await record.tracks.list({
      start: parseInt(start, 10) || null,
      limit: parseInt(limit, 10) || null,
      addresses,
      tags,
      shuffle,
      query,
      sort,
      order
    })
    res.send(tracks)
  } catch (err) {
    req.app.locals.record.logger.error(err)
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
      record.emit('redux', {
        type: 'TRACK_ADDED',
        payload: { data: track, address: record.address }
      })
      return res.send(track)
    }

    res.status(400).send({ error: 'Body missing one of \'cid\', \'url\', or \'file\'' })
  } catch (err) {
    req.app.locals.record.logger.error(err)
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
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
