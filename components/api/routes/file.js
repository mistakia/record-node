const express = require('express')
const fileType = require('file-type')
const mime = require('mime-types')
const peek = require('buffer-peek-stream')
const toStream = require('it-to-stream')
const { CID } = require('ipfs')

const router = express.Router()

const detectContentType = (chunk) => {
  const fileSignature = fileType(chunk)
  if (!fileSignature) {
    return ''
  }

  const mimeType = mime.lookup(fileSignature.ext)
  return mime.contentType(mimeType)
}

router.get('/:cid([a-zA-Z0-9]{46})', async (req, res) => {
  try {
    const { cid } = req.params
    const { localOnly, logAddress } = req.query
    const { record } = req.app.locals

    if (localOnly) {
      const haveLocally = await record._ipfs.repo.has(new CID(cid))
      if (!haveLocally) {
        return res.status(204).send(null)
      }
    }

    const range = req.headers.range

    // FIX for strange delay in getting file stats
    const getSize = (delay) => new Promise((resolve, reject) => {
      // Exponentially back-off
      const timeout = setTimeout(() => getSize(delay * 2).then(resolve), delay)

      record._ipfs.files.stat(`/ipfs/${cid}`, { size: true }).then(({ size }) => {
        clearTimeout(timeout)
        resolve(size)
      })
    })

    const size = await getSize(1000)

    let offset
    let length
    const head = {}

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1
      const chunksize = (end - start) + 1
      offset = start
      length = chunksize

      head['Content-Range'] = `bytes ${start}-${end}/${size}`
      head['Accept-Ranges'] = 'bytes'
      head['Content-Length'] = chunksize
    } else {
      head['Content-Length'] = size
    }

    const rawStream = toStream.readable(record._ipfs.cat(cid, { offset, length }))
    const { peekedStream, contentType } = await new Promise((resolve, reject) => {
      const peekBytes = fileType.minimumBytes
      peek(rawStream, peekBytes, (err, streamHead, peekedStream) => {
        if (err) {
          return reject(err)
        }
        resolve({ peekedStream, contentType: detectContentType(streamHead) })
      })
    })

    head['Content-Type'] = contentType
    res.writeHead(range ? 206 : 200, head)
    peekedStream.pipe(res)

    // TODO re-enable pinning
    /* if (logAddress) {
     *   const shouldPin = await record.logs.has(record.address, logAddress)
     *   if (shouldPin) await record._ipfs.pin.add(cid)
     * }

     * record.gc() */
  } catch (err) {
    req.app.locals.record.logger.err(err)
    res.status(500).send({ error: err.toString() })
  }
})

module.exports = router
