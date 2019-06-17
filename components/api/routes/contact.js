const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals

    const contact = await record.contacts.get({
      logId: logAddress,
      contactAddress: logAddress
    })
    res.send(contact)
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
