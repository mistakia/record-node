const express = require('express')
const router = express.Router()

router.get(':logAddress(*)', async (req, res) => {
  try {
    const { logAddress } = req.params
    const { record } = req.app.locals
    const contacts = await record.contacts.list(logAddress)
    res.send(contacts)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/?', (req, res, next) => {
  const { address, alias } = req.body

  let errors = []

  // TODO: sanitize
  // TODO: validate address (OrbitDB)
  if (!address) errors.push('Missing address field')

  if (!alias) errors.push('Missing alias field')

  if (!errors.length) {
    res.locals.data = { address, alias }
    return next()
  }

  res.status(422).send({
    error: errors.join(', ')
  })
}, async (req, res) => {
  try {
    const { address, alias } = res.locals.data
    const { record } = req.app.locals
    const entry = await record.contacts.add({ address, alias })
    res.send(entry)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
