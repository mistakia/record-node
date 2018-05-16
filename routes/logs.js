const express = require('express')
const router = express.Router()

const RecordLog = require('../log')

const loadLog = async (req, res, next) => {
  const logAddress = req.params.logAddress

  if (!logAddress || logAddress === 'me') {
    req._log = req.log
    return next()
  }

  req._log = new RecordLog(req.orbitdb, logAddress)
  await req._log.load()
  next()
}

router.get('/:logAddress/tracks', loadLog, (req, res) => {
  const data = req._log.tracks.all()
  return res.send(data)
})

router.post('/:logAddress/tracks', loadLog, (req, res) => {
  //TODO: validate title
  //TODO: validate if you have write permissions for database

  const { title, url } = req.query

  const data = req._log.tracks.add({ url, title })
  return res.send(data)
})

router.get('/:logAddress/logs', loadLog, (req, res) => {
  const data = req._log.logs.all()
  return res.send(data)
})

router.post('/:logAddress/logs', loadLog, (req, res) => {
  const address = req.query.address
  const data = req._log.logs.add({ address })
  return res.send(data)
})

module.exports = router
