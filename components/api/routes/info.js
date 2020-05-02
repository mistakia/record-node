const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { record } = req.app.locals
    const data = await record.info.get()
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.send({ error: err.toString() })
  }
})

module.exports = router
