const express = require('express')
const router = express.Router()

router.post('/?', async (req, res) => {
  try {
    const { name, bio, location } = req.body
    const { record } = req.app.locals
    const about = await record.about.set({ name, bio, location })
    const { address } = about.content
    const data = await record.logs.get({ sourceAddress: address, targetAddress: address })
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
