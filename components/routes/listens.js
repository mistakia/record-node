const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { limit, start } = req.query
    const listens = await req.app.locals.rn.listens.list({ limit, start })
    res.send(listens)
  } catch (err) {
    res.send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  const { trackId, logId } = req.body

  try {
    const entry = await req.app.locals.rn.listens.add({ trackId, logId })
    res.send(entry)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
