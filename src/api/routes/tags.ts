import { Router } from 'express'

import type { ApiPeer } from '#types/peer.ts'
import { assert_label_writer, type ManagedLabelLibraries } from '../middleware.ts'
import { query_list, query_value } from './query.ts'

export const tags_router = (peer: ApiPeer, managed: ManagedLabelLibraries): Router => {
  const router = Router()

  router.get('/', async (req, res) => {
    const library_addresses = query_list(req, 'library_addresses')
    const label_libraries = query_list(req, 'label_libraries')
    const prefix = query_value<string>(req, 'prefix')
    res.json(await peer.list_tags({
      ...(library_addresses === undefined ? {} : { library_addresses }),
      ...(label_libraries === undefined ? {} : { label_libraries }),
      ...(prefix === undefined ? {} : { prefix }),
      managed_libraries: [...managed.keys()]
    }))
  })

  router.post('/batch', async (req, res) => {
    const { items, library_address, capability_id } = req.body
    assert_label_writer(managed, res, library_address)
    res.json({ results: await peer.change_labels_batch({ items, library_address, capability_id }) })
  })

  router.post('/', async (req, res) => {
    const { track_id, tag, library_address, capability_id } = req.body
    assert_label_writer(managed, res, library_address)
    res.json(await peer.add_tag({ track_id, tag, library_address, capability_id }))
  })

  router.delete('/', async (req, res) => {
    const library_address = query_value<string>(req, 'library_address')
    assert_label_writer(managed, res, library_address)
    res.json(await peer.remove_tag({
      track_id: query_value<string>(req, 'track_id') ?? '',
      tag: query_value<string>(req, 'tag') ?? '',
      library_address,
      capability_id: query_value<string>(req, 'capability_id')
    }))
  })

  return router
}
