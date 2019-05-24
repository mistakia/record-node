const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const opts = { end, start } = req.query
    const { record } = req.app.locals
    const listens = await record.listens.list(opts)
    res.send(listens)
  } catch (err) {
    res.send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { trackId, logId } = req.body
    const { record } = req.app.locals
    const entry = await record.listens.add({ trackId, logId })
    res.send(entry)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
