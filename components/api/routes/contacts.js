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
  const { record } = req.app.locals

  let errors = []

  if (!address) {
    errors.push('Missing address field')
  } else if (!record.isValidAddress(address)) {
    // TODO: validate
    // errors.push('Invalid OrbitDB address')
  }

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
    const contact = await record.contacts.add({ address, alias })
    res.send(contact)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.delete('/?', async (req, res) => {
  try {
    const { contactId } = req.query
    const { record } = req.app.locals
    const contact = await record.contacts.remove(contactId)
    res.send(contact)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
