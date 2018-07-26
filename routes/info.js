const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const data = await req.app.locals.rn.info()
    res.send(data)
  } catch (err) {
    res.send({ error: err })
  }
})

module.exports = router
