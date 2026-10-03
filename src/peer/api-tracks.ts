// ApiPeer track, tag, and audio methods over the own library.

import { build_track_envelope } from '#entry/envelope.ts'
import { build_del_operation, build_put_operation, is_put } from '#entry/operations.ts'
import { ingest_cid } from '#ingest/pipeline-cid.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { get_track, list_tags, list_tracks } from '#query-db/queries.ts'
import type { Envelope } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { PeerError, type ApiPeer, type Track } from '#types/peer.ts'
import { ingest_into_own, require_identity, serialise_write, visible_addresses, type PeerContext } from './context.ts'
import { to_api_track, to_api_tracks } from './views.ts'

// A CID that is no UnixFS file, or whose blocks are not all local, is no
// audio this peer can serve.
// The own library's view of one track.
const own_track = (context: PeerContext, track_id: string): Track => {
  const { own_address } = require_identity(context)
  const row = get_track({ db: context.db, track_id, own_library_address: own_address, library_addresses: [own_address] })
  const track = row === undefined ? undefined : to_api_track(row)
  if (track === undefined) throw new PeerError('not_found', `not in the own library: ${track_id}`)
  return track
}

const live_envelope = (context: PeerContext, track_id: string): Envelope => {
  const { own_address } = require_identity(context)
  const oplog = context.libraries.get(own_address)?.oplog
  const live = oplog === undefined ? undefined : get_live_entry({ oplog, key: track_id })
  if (live === undefined || !is_put(live.operation) || live.operation.value.type !== 'track') {
    throw new PeerError('not_found', `not in the own library: ${track_id}`)
  }
  return live.operation.value
}

// Relabelling appends a new PUT of the same content with the new tags (§2.4.3).
const relabel = async (context: PeerContext, { track_id, tags }: { track_id: string, tags: (current: readonly string[]) => readonly string[] | undefined }): Promise<Track> =>
  await serialise_write(context, async () => {
    const { key_pair, own_address } = require_identity(context)
    const envelope = live_envelope(context, track_id)
    const next = tags(envelope.tags ?? [])
    if (next !== undefined) {
      const payload = build_put_operation({ envelope: build_track_envelope({ id: envelope.id, content_cid: envelope.content, tags: next }) })
      await context.libraries.append({ library_address: own_address, payload, key_pair })
    }
    return own_track(context, track_id)
  })

export const create_track_methods = (context: PeerContext): Pick<ApiPeer,
  'list_tracks' | 'add_track' | 'remove_track' | 'list_tags' | 'add_tag' | 'remove_tag' | 'get_audio' | 'has_audio'> => ({
  list_tracks: async ({ library_addresses, ...query }) => {
    const { items, total } = list_tracks({
      db: context.db,
      own_library_address: require_identity(context).own_address,
      library_addresses: library_addresses ?? visible_addresses(context),
      ...query
    })
    return { items: to_api_tracks(items), total }
  },

  // CID ingest (§6.4.3): the content object must already be stored locally.
  add_track: async (content_cid) => {
    let track_id: string
    try {
      track_id = (await ingest_into_own(context, async (target) => await ingest_cid({ content_cid, target }))).track_id
    } catch (error) {
      if (error instanceof ProtocolError && error.code === 'content_unavailable') throw new PeerError('not_found', error.message)
      throw error
    }
    return own_track(context, track_id)
  },

  remove_track: async (track_id) => {
    await serialise_write(context, async () => {
      const { key_pair, own_address } = require_identity(context)
      live_envelope(context, track_id)
      await context.libraries.append({ library_address: own_address, payload: build_del_operation({ key: track_id, type: 'track' }), key_pair })
    })
  },

  list_tags: async ({ library_addresses }) => list_tags({ db: context.db, library_addresses: library_addresses ?? visible_addresses(context) }),

  add_tag: async ({ track_id, tag }) => await relabel(context, {
    track_id,
    tags: (current) => {
      if (current.includes(tag)) throw new PeerError('conflict', `already tagged ${tag}: ${track_id}`)
      return [...current, tag]
    }
  }),

  remove_tag: async ({ track_id, tag }) => await relabel(context, {
    track_id,
    tags: (current) => current.includes(tag) ? current.filter((label) => label !== tag) : undefined
  }),

  get_audio: async (cid) => await context.audio.read(cid),
  has_audio: async (cid) => await context.audio.read_local(cid) !== undefined
})
