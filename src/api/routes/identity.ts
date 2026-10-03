import { Router } from 'express'

import type { ApiPeer } from '#types/peer.ts'
import { about_fields } from './libraries.ts'
import { page, query_value } from './query.ts'

export const identity_router = (peer: ApiPeer): Router => {
  const router = Router()

  router.get('/', async (_req, res) => {
    res.json(await peer.get_identity())
  })

  // Private key material, for an explicit user export only (§8.5.7).
  router.get('/export', async (_req, res) => {
    res.json(await peer.export_identity())
  })

  // The body is optional; without a private_key the peer generates one.
  router.post('/import', async (req, res) => {
    const private_key: unknown = req.body?.private_key
    res.json(await peer.import_identity(typeof private_key === 'string' ? { private_key } : {}))
  })

  router.get('/libraries', async (_req, res) => {
    res.json(await peer.list_own_libraries())
  })

  router.post('/libraries', async (req, res) => {
    const { discriminator, about } = (req.body ?? {}) as { discriminator?: string, about?: Record<string, unknown> }
    res.status(201).json(await peer.create_own_library({ discriminator, about: about === undefined ? undefined : about_fields(about) }))
  })

  router.delete('/libraries/:address', async (req, res) => {
    await peer.retire_own_library(req.params.address)
    res.status(204).end()
  })

  router.get('/capabilities', async (_req, res) => {
    res.json(await peer.list_held_capabilities())
  })

  router.get('/meta-log', async (req, res) => {
    res.json(await peer.read_meta_log({
      ...page(req),
      type: query_value<string>(req, 'type'),
      current_only: query_value<boolean>(req, 'current_only') ?? false
    }))
  })

  return router
}
