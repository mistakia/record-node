const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { limit, start, cid } = req.query
    const { record } = req.app.locals
    const data = await record.feed.list({ limit, start, cid })
    res.send(data)
  } catch (err) {
    res.send({ error: err.toString() })
  }
})

module.exports = router
