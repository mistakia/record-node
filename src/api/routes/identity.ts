import { Router } from 'express'

import { canonical_cid } from '#entry/identity-record.ts'
import type { ApiPeer } from '#types/peer.ts'
import { ApiError } from '../middleware.ts'
import { page, query_value } from './query.ts'

// An avatar is a CID in any valid form, never a URL that would leak a
// viewer's network identity (§4.8.2).
const assert_avatar = (avatar: string | undefined): void => {
  if (avatar === undefined) return
  try {
    canonical_cid(avatar)
  } catch {
    throw new ApiError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'avatar must be a content-addressed CID, not a URL',
      details: [{ field: 'avatar', message: 'not a CID' }]
    })
  }
}

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

  router.get('/profile', async (_req, res) => {
    res.json(await peer.get_profile())
  })

  // The whole profile: a field the body omits is absent afterwards (§4.8.2).
  router.put('/profile', async (req, res) => {
    const { name, bio, avatar } = req.body as { name?: string, bio?: string, avatar?: string }
    assert_avatar(avatar)
    res.json(await peer.set_profile({ name, bio, avatar }))
  })

  router.get('/libraries', async (_req, res) => {
    res.json(await peer.list_own_libraries())
  })

  router.post('/libraries', async (req, res) => {
    const { name } = req.body as { name: string }
    res.status(201).json(await peer.create_own_library({ name }))
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
