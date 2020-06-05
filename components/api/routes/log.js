const express = require('express')
const router = express.Router()

router.get(':address(*)', async (req, res) => {
  try {
    const { address } = req.params
    const { record } = req.app.locals

    await record.logs.connect(address)
    const data = await record.logs.get({
      targetAddress: address
    })
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.delete(':address(*)', async (req, res) => {
  try {
    const { address } = req.params
    const { record } = req.app.locals

    const response = await record.logs.drop(address)
    res.send(response)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
