import { Router } from 'express'

import type { ApiPeer } from '#types/peer.ts'
import { query_list, query_value } from './query.ts'

export const tags_router = (peer: ApiPeer): Router => {
  const router = Router()

  router.get('/', async (req, res) => {
    const library_addresses = query_list(req, 'library_addresses')
    res.json(await peer.list_tags(library_addresses === undefined ? {} : { library_addresses }))
  })

  router.post('/', async (req, res) => {
    const { track_id, tag } = req.body
    res.json(await peer.add_tag({ track_id, tag }))
  })

  router.delete('/', async (req, res) => {
    res.json(await peer.remove_tag({
      track_id: query_value<string>(req, 'track_id') ?? '',
      tag: query_value<string>(req, 'tag') ?? ''
    }))
  })

  return router
}
