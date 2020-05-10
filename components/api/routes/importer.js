const express = require('express')
const router = express.Router()

router.get('/?', async (req, res) => {
  try {
    const { record } = req.app.locals
    const data = record.importer.list()
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', async (req, res) => {
  try {
    let { files } = req.body
    const { record } = req.app.locals

    if (!Array.isArray(files)) {
      files = [files]
    }

    files.forEach(file => record.importer.add(file))
    return res.send({ success: true })
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
