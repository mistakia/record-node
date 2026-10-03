import { rm } from 'node:fs/promises'
import { Router } from 'express'

import type { ApiPeer } from '#types/peer.ts'

export const import_router = (peer: ApiPeer): Router => {
  const router = Router()

  // Request validation has already buffered the upload to disk. Ingest owns
  // the temp files once it accepts them; until then they are ours to remove.
  router.post('/file', async (req, res) => {
    const paths = (req.files as Express.Multer.File[]).map((file) => file.path)
    try {
      res.status(202).json(await peer.import_files(paths))
    } catch (error) {
      await Promise.all(paths.map(async (path) => await rm(path, { force: true })))
      throw error
    }
  })

  router.post('/url', async (req, res) => {
    res.status(202).json(await peer.import_url(req.body.url))
  })

  return router
}
