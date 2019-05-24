const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const opts = { end, start, hash } = req.query
    const { record } = req.app.locals
    const data = await record.feed.list(opts)
    res.send(data)
  } catch (err) {
    res.send({ error: err.toString() })
  }
})

module.exports = router
