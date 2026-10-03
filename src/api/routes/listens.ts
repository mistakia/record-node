import { Router } from 'express'

import type { ApiPeer } from '#types/peer.ts'
import { page } from './query.ts'

export const listens_router = (peer: ApiPeer): Router => {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await peer.list_listens(page(req)))
  })

  // The peer assigns the timestamp (§2.7).
  router.post('/', async (req, res) => {
    const { track_id, library_address } = req.body
    res.json(await peer.record_listen({ track_id, library_address }))
  })

  return router
}
