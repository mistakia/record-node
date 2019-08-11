const express = require('express')
const router = express.Router()

router.post('/?', async (req, res) => {
  try {
    const { privateKey } = req.body
    const { record } = req.app.locals
    const data = await record.setIdentity(privateKey)
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
