const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { contactId } = req.query
    const { record } = req.app.locals
    await record.contacts.disconnect(logAddress, contactId)
    res.send({ success: true })
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
