const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { record } = req.app.locals
    const { start, limit } = req.query
    const listens = await record.listens.list({
      start: parseInt(start, 10),
      limit: parseInt(limit, 10)
    })
    res.send(listens)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { trackId, logAddress, cid } = req.body
    const { record } = req.app.locals
    const entry = await record.listens.add({ trackId, logAddress, cid })
    res.send(entry)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
