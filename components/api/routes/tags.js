const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals
    const tags = await record.tags.list(logAddress)
    res.send(tags)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { cid, tag } = req.body
    const { record } = req.app.locals
    const entry = await record.tags.add(cid, tag)
    res.send(entry.payload.value)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.delete('/?', async (req, res) => {
  try {
    const { trackId, tag } = req.query
    const { record } = req.app.locals
    const entry = await record.tags.remove(trackId, tag)
    res.send(entry.payload.value)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
