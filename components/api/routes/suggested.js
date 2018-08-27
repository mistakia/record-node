const express = require('express')
const router = express.Router()

router.get('/contacts', async (req, res) => {
  try {
    const { record } = req.app.locals
    const contacts = await record.suggested.contacts()
    res.send(contacts)
  } catch (err) {
    res.send({ error: err.toString() })
  }
})

module.exports = router
