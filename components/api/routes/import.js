const express = require('express')
const router = express.Router()

router.post('/?', async (req, res) => {
  try {
    const { privateKey } = req.body
    const { record } = req.app.locals
    const data = privateKey
      ? await record.setIdentity(privateKey)
      : await record.createIdentity()

    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
