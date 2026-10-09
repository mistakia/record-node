import { Router } from 'express'
import { fileTypeFromBuffer } from 'file-type'

import type { ApiPeer } from '#types/peer.ts'
import { ProtocolError } from '#types/errors.ts'
import { ApiError } from '../middleware.ts'

const MIME_SNIFF_BYTES = 4100

// A CID never names other bytes, so a client keeps what it fetched.
const IMMUTABLE = 'private, max-age=31536000, immutable'

// The blob and its sniffed type, or undefined when it is absent, over the
// cap, not an image, or the string is not a CID. Only image/* is served, so
// the route is no generic blob fetch.
const read_image = async (peer: ApiPeer, cid: string, local_only: boolean) => {
  let bytes: Uint8Array | undefined
  try {
    bytes = await peer.get_image(cid, { local_only })
  } catch (error) {
    if (error instanceof ProtocolError && error.code === 'invalid_cid') return undefined
    throw error
  }
  if (bytes === undefined) return undefined
  const mime = await sniff_image(bytes)
  return mime === undefined ? undefined : { bytes, mime }
}

// The sniffed image/* type of the first bytes, or undefined.
const sniff_image = async (bytes: Uint8Array) => {
  const type = await fileTypeFromBuffer(bytes.subarray(0, MIME_SNIFF_BYTES))
  return type?.mime.startsWith('image/') === true ? type.mime : undefined
}

export const images_router = (peer: ApiPeer): Router => {
  const router = Router()

  // parse_image_upload has already buffered the file and refused one over
  // the size cap; a refused upload is never stored.
  router.post('/', async (req, res) => {
    const bytes = new Uint8Array((req.file as Express.Multer.File).buffer)
    const mime = await sniff_image(bytes)
    if (mime === undefined) {
      throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: 'file is not an image', details: [{ field: 'file', message: 'does not sniff as image/*' }] })
    }
    res.status(201).json({ cid: await peer.put_image(bytes), mime })
  })

  router.head('/:cid', async (req, res) => {
    res.status(await read_image(peer, req.params.cid, true) === undefined ? 404 : 200).end()
  })

  router.get('/:cid', async (req, res) => {
    const image = await read_image(peer, req.params.cid, false)
    if (image === undefined) {
      throw new ApiError({ status: 404, code: 'NOT_FOUND', message: `no image locally or from peers: ${req.params.cid}` })
    }
    res.setHeader('Content-Type', image.mime)
    res.setHeader('Content-Length', image.bytes.length)
    res.setHeader('Cache-Control', IMMUTABLE)
    res.status(200).end(image.bytes)
  })

  return router
}
