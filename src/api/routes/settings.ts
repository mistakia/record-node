import { Router } from 'express'

import type { ApiPeer } from '#types/peer.ts'

export const settings_router = (peer: ApiPeer): Router => {
  const router = Router()
  router.get('/', async (_req, res) => { res.json(await peer.get_settings()) })
  return router
}
