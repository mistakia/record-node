import { Router } from 'express'

import { is_cid_string } from '#encoding/cid.ts'
import type { AboutUpdate, ApiPeer, Library } from '#types/peer.ts'
import { ApiError } from '../middleware.ts'
import { query_value } from './query.ts'

const ABOUT_FIELDS = ['name', 'bio', 'location', 'avatar'] as const

const not_found = (address: string) =>
  new ApiError({ status: 404, code: 'NOT_FOUND', message: `unknown library: ${address}` })

// An avatar is a CID, never a URL that would leak a viewer's network identity (§2.6).
export const about_fields = (body: Record<string, unknown>): AboutUpdate => {
  const avatar = body.avatar
  if (avatar !== undefined && avatar !== null && !is_cid_string(avatar)) {
    throw new ApiError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'avatar must be a content-addressed CID, not a URL',
      details: [{ field: 'avatar', message: 'not a base58btc CID' }]
    })
  }
  const fields: AboutUpdate = {}
  for (const field of ABOUT_FIELDS) {
    if (body[field] !== undefined) fields[field] = body[field] as string | null
  }
  return fields
}

export const libraries_router = (peer: ApiPeer): Router => {
  const router = Router()

  const known_library = async (address: string): Promise<Library> => {
    const library = await peer.get_library(address)
    if (library === undefined) throw not_found(address)
    return library
  }

  router.get('/', async (_req, res) => {
    res.json(await peer.list_libraries())
  })

  router.post('/', async (req, res) => {
    const { library_address, alias } = req.body
    if ((await peer.get_library(library_address))?.is_linked === true) {
      throw new ApiError({ status: 409, code: 'CONFLICT', message: `already linked: ${library_address}` })
    }
    res.json(await peer.link_library({ address: library_address, alias: alias ?? null }))
  })

  router.get('/:address', async (req, res) => {
    res.json(await known_library(req.params.address))
  })

  router.delete('/:address', async (req, res) => {
    await known_library(req.params.address)
    await peer.unlink_library(req.params.address)
    res.status(204).end()
  })

  router.get('/:address/replication-policy', async (req, res) => {
    res.json(await peer.get_replication_policy(req.params.address))
  })

  router.put('/:address/replication-policy', async (req, res) => {
    const { mode, filter } = req.body
    res.json(await peer.set_replication_policy({ address: req.params.address, mode, filter }))
  })

  router.get('/:address/capabilities', async (req, res) => {
    await known_library(req.params.address)
    res.json(await peer.list_capabilities(req.params.address))
  })

  router.post('/:address/capabilities', async (req, res) => {
    await known_library(req.params.address)
    const { grantee, actions, filter, conditions, capability_id } = req.body
    res.status(201).json(await peer.issue_capability({ library_address: req.params.address, grantee, actions, filter, conditions, capability_id }))
  })

  router.delete('/:address/capabilities/:id', async (req, res) => {
    await known_library(req.params.address)
    await peer.revoke_capability({
      library_address: req.params.address,
      capability_id: req.params.id,
      via_capability_id: query_value<string>(req, 'capability_id')
    })
    res.status(204).end()
  })

  router.post('/:address/connect', async (req, res) => {
    await known_library(req.params.address)
    await peer.connect_library(req.params.address)
    res.status(202).end()
  })

  router.post('/:address/disconnect', async (req, res) => {
    await known_library(req.params.address)
    await peer.disconnect_library(req.params.address)
    res.status(202).end()
  })

  router.get('/:address/about', async (req, res) => {
    const about = await peer.get_about(req.params.address)
    if (about === undefined) throw not_found(req.params.address)
    res.json(about)
  })

  // The owner writes it, or a holder of library.update_about (§3.5.6).
  router.post('/:address/about', async (req, res) => {
    const { address } = req.params
    const body = req.body as Record<string, unknown>
    const fields = about_fields(body)
    await known_library(address)
    const capability_id = typeof body.capability_id === 'string' ? body.capability_id : undefined
    res.json(await peer.set_about({ address, fields, capability_id }))
  })

  return router
}
