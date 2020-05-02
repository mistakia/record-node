const express = require('express')
const router = express.Router()

router.get('/all', async (req, res) => {
  try {
    const { record } = req.app.locals
    const data = await record.logs.all()
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.send({ error: err.toString() })
  }
})

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals

    const data = await record.logs.list(logAddress)
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', (req, res, next) => {
  const { linkAddress, alias } = req.body
  const { record } = req.app.locals

  const errors = []

  if (!linkAddress) {
    errors.push('Missing address field')
  } else if (!record.isValidAddress(linkAddress)) {
    errors.push('Invalid OrbitDB address')
  }

  if (!errors.length) {
    res.locals.data = { linkAddress, alias }
    return next()
  }

  res.status(422).send({
    error: errors.join(', ')
  })
}, async (req, res) => {
  try {
    const { linkAddress, alias } = res.locals.data
    const { record } = req.app.locals
    const data = await record.logs.link({ linkAddress, alias })
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

router.delete('/?', async (req, res) => {
  try {
    const { linkAddress } = req.query
    const { record } = req.app.locals
    const data = await record.logs.unlink(linkAddress)
    res.send(data)
  } catch (err) {
    req.app.locals.record.logger.error(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
