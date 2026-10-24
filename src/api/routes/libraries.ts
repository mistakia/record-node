import { Router } from 'express'

import type { ApiPeer, Library } from '#types/peer.ts'
import { ApiError } from '../middleware.ts'
import { page, query_value } from './query.ts'

const not_found = (address: string) =>
  new ApiError({ status: 404, code: 'NOT_FOUND', message: `unknown library: ${address}` })

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
    const { name, capability_id } = req.body as { name: string, capability_id?: string }
    await known_library(address)
    res.json(await peer.set_about({ address, name, capability_id }))
  })

  // The library's label state, whatever holds the tracks (§2.5).
  router.get('/:address/labels', async (req, res) => {
    res.json(await peer.list_library_labels({ address: req.params.address, ...page(req) }))
  })

  router.get('/:address/profile', async (req, res) => {
    const profile = await peer.get_library_profile(req.params.address)
    if (profile === undefined) throw new ApiError({ status: 404, code: 'NOT_FOUND', message: `no owner profile known for ${req.params.address}` })
    res.json(profile)
  })

  return router
}
