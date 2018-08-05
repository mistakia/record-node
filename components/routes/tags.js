const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const tags = await req.app.locals.rn.tags.list(logAddress)
    res.send(tags)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { track, tag } = req.body
    const trackData = await req.app.locals.rn.tags.add(track, tag)
    res.send(trackData)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.delete('/?', async (req, res) => {
  try {
    const { trackId, tag } = req.query
    const track = await req.app.locals.rn.tags.remove(trackId, tag)
    res.send(track)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
