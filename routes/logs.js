const express = require('express')
const router = express.Router()

const RecordLog = require('../log')

const loadLog = async (req, res, next) => {
  const logAddress = `/${req.params.logAddress}`

  if (!logAddress || logAddress === '/me') {
    res.locals.log = req.app.locals.log
    return next()
  }

  res.locals.log = new RecordLog(req.app.locals.orbitdb, logAddress)
  await res.locals.log.load()
  next()
}

router.get('/tracks/:logAddress(*)', loadLog, (req, res) => {
  const data = res.locals.log.tracks.all()
  return res.send(data)
})

router.post('/tracks/:logAddress(*)', loadLog, async (req, res) => {
  //TODO: validate title
  //TODO: validate if you have write permissions for database

  const { title, url } = req.query

  const data = await res.locals.log.tracks.findOrCreate({ url, title })
  return res.send(data)
})

router.get('/contacts/:logAddress(*)', loadLog, (req, res) => {
  const data = res.locals.log.contacts.all()
  return res.send(data)
})

router.post('/contacts/:logAddress(*)', loadLog, async (req, res) => {
  const { address, alias } = req.query
  const data = await res.locals.log.contacts.findOrCreate({ address, alias })
  return res.send(data)
})

module.exports = router
