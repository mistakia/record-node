const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals

    const data = await record.logs.get({
      targetAddress: logAddress
    })
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.delete(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals

    const response = await record.logs.drop(logAddress)
    res.send(response)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
