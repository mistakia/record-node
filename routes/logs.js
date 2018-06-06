const express = require('express')
const router = express.Router()

const loadLog = async (req, res, next) => {
  const logAddress = `/${req.params.logAddress}`

  res.locals.log = await req.app.locals.getLog(logAddress)
  next()
}

router.get('/tracks/:logAddress(*)', loadLog, (req, res) => {
  const data = res.locals.log.tracks.all()
  return res.send(data)
})

router.post('/tracks/:logAddress(*)', loadLog, async (req, res) => {
  // TODO: validate title
  // TODO: validate if you have write permissions for database

  const { title, url } = req.query

  const data = await res.locals.log.tracks.findOrCreate({ url, title })
  return res.send(data)
})

router.get('/contacts/:logAddress(*)', loadLog, (req, res) => {
  const data = res.locals.log.contacts.all()

  return res.send(data)
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
  const { address, alias } = res.locals.data
  const data = await res.locals.log.contacts.findOrCreate({ address, alias })
  return res.send(data)
})

module.exports = router
