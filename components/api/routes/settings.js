const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { record } = req.app.locals
    const data = await record.info.get()
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/importer', async (req, res) => {
  try {
    const { filepath } = req.body
    const { record } = req.app.locals
    const directory = await record.importer.setDirectory(filepath)
    res.send({ directory })
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
