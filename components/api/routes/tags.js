const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals
    const tags = await record.tags.list(logAddress)
    res.send(tags)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { track, tag } = req.body
    const { record } = req.app.locals
    const trackData = await record.tags.add(track, tag)
    res.send(trackData)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.delete('/?', async (req, res) => {
  try {
    const { trackId, tag } = req.query
    const { record } = req.app.locals
    const track = await record.tags.remove(trackId, tag)
    res.send(track)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
