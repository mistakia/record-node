const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals
    const profile = await record.profile.get(logAddress)
    res.send(profile)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    const { name, bio, location } = req.body
    const { record } = req.app.locals
    const profile = await record.profile.set({ name, bio, location })
    res.send(profile)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
