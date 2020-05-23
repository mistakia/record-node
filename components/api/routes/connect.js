const express = require('express')
const router = express.Router()

router.get(':address(*)', async (req, res) => {
  try {
    const { address } = req.params
    const { record } = req.app.locals
    await record.logs.connect(address)
    res.send({ success: true })
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
