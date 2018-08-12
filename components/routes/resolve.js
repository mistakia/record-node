const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { url } = req.query
    const { record } = req.app.locals
    const data = await record.resolve(url)
    res.send(data)
  } catch (err) {
    res.send({ error: err.toString() })
  }
})

module.exports = router
