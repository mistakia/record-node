import { Router } from 'express'

import type { ApiPeer, TrackSort } from '#types/peer.ts'
import { page, query_list, query_value } from './query.ts'

export const tracks_router = (peer: ApiPeer): Router => {
  const router = Router()

  router.get('/', async (req, res) => {
    const library_addresses = query_list(req, 'library_addresses')
    const tags = query_list(req, 'tags')
    const query = query_value<string>(req, 'query')
    res.json(await peer.list_tracks({
      ...page(req),
      ...(library_addresses === undefined ? {} : { library_addresses }),
      ...(tags === undefined ? {} : { tags }),
      ...(query === undefined ? {} : { query }),
      shuffle: query_value<boolean>(req, 'shuffle') ?? false,
      sort: query_value<TrackSort>(req, 'sort') ?? 'added_at',
      order: query_value<'asc' | 'desc'>(req, 'order') ?? 'desc'
    }))
  })

  router.post('/', async (req, res) => {
    res.json(await peer.add_track(req.body.content_cid))
  })

  router.delete('/:id', async (req, res) => {
    await peer.remove_track(req.params.id)
    res.status(204).end()
  })

  return router
}
