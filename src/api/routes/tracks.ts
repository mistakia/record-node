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
    const { content_cid, library_address, capability_id } = req.body
    res.json(await peer.add_track({ content_cid, library_address, capability_id }))
  })

  router.patch('/:id', async (req, res) => {
    const { tags, library_address, capability_id } = req.body
    res.json(await peer.update_track({ track_id: req.params.id, tags, library_address, capability_id }))
  })

  router.delete('/:id', async (req, res) => {
    await peer.remove_track({ track_id: req.params.id, library_address: query_value<string>(req, 'library_address') })
    res.status(204).end()
  })

  router.post('/:cid/pin', async (req, res) => {
    await peer.pin_track(req.params.cid)
    res.status(204).end()
  })

  router.delete('/:cid/pin', async (req, res) => {
    await peer.unpin_track(req.params.cid)
    res.status(204).end()
  })

  return router
}
