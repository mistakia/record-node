const express = require('express')
const router = express.Router()

const loadLog = async (req, res, next) => {
  const logAddress = `/${req.params.logAddress}`

  try {
    res.locals.log = await req.app.locals.loadLog(logAddress)
    next()
  } catch (err) {
    res.send(500).send({ error: err.toString() })
  }
}

router.get('/tracks/:logAddress(*)', loadLog, async (req, res) => {
  try {
    const entries = await res.locals.log.tracks.all()
    const tracks = entries.map(e => e.payload.value)
    res.send(tracks)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/tracks/:logAddress(*)', loadLog, async (req, res) => {
  // TODO: validate title
  // TODO: validate if you have write permissions for database

  const { title, url } = req.body

  try {
    const entry = await res.locals.log.tracks.findOrCreate({ url, title })
    res.send(entry)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.get('/contacts/:logAddress(*)', loadLog, async (req, res) => {
  try {
    const entries = await res.locals.log.contacts.all()
    const contacts = entries.map(e => e.payload.value)
    res.send(contacts)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

router.post('/contacts/:logAddress(*)', loadLog, (req, res, next) => {
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
    const entry = await res.locals.log.contacts.findOrCreate({ address, alias })
    res.send(entry)
  } catch (err) {
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
