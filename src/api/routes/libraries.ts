import { Router } from 'express'

import { is_cid_string } from '#encoding/cid.ts'
import type { AboutUpdate, ApiPeer, Library } from '#types/peer.ts'
import { ApiError } from '../middleware.ts'

const ABOUT_FIELDS = ['name', 'bio', 'location', 'avatar'] as const

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

  // Only the owning library writes its About, and an avatar is a CID,
  // never a URL that would leak a viewer's network identity (§2.6).
  router.post('/:address/about', async (req, res) => {
    const { address } = req.params
    const body = req.body as Record<string, unknown>
    const avatar = body.avatar
    if (avatar !== undefined && avatar !== null && !is_cid_string(avatar)) {
      throw new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'avatar must be a content-addressed CID, not a URL',
        details: [{ field: 'avatar', message: 'not a base58btc CID' }]
      })
    }
    if (!(await known_library(address)).is_own) {
      throw new ApiError({ status: 403, code: 'FORBIDDEN', message: `not the owner of ${address}` })
    }
    const fields: AboutUpdate = {}
    for (const field of ABOUT_FIELDS) {
      if (body[field] !== undefined) fields[field] = body[field] as string | null
    }
    res.json(await peer.set_about({ address, fields }))
  })

  return router
}
