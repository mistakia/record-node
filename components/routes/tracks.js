const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { start, limit, tag } = req.query
    const tracks = await req.app.locals.rn.tracks.list(logAddress, { start, limit, tag })
    res.send(tracks)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  // TODO: validate title
  // TODO: validate if you have write permissions for database
  try {
    const { title, url } = req.body
    const entry = await req.app.locals.rn.tracks.add({ url, title })
    res.send(entry)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
