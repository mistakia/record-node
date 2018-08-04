const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { limit, start } = req.query
    const data = await req.app.locals.rn.feed.list({ limit, start })
    res.send(data)
  } catch (err) {
    res.send({ error: err.toString() })
  }
})

module.exports = router
