const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { record } = req.app.locals
    const listens = await record.listens.list(req.query)
    res.send(listens)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { trackId, logAddress } = req.body
    const { record } = req.app.locals
    const entry = await record.listens.add({ trackId, logAddress })
    res.send(entry)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
