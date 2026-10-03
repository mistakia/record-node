// ApiPeer track, tag, pin, and audio methods. Writes go to a write target:
// an own library, or one written under a capability (chapter 7).

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { assert_payload_size } from '#encoding/size-bounds.ts'
import { build_track_envelope } from '#entry/envelope.ts'
import { build_identity_del, build_identity_put, canonical_cid, identity_record_key } from '#entry/identity-record.ts'
import { build_del_operation, build_put_operation, is_put } from '#entry/operations.ts'
import { decode_payload, validate_track_content } from '#entry/payload.ts'
import { ingest_cid } from '#ingest/pipeline-cid.ts'
import { resolve_current_state } from '#oplog/current-state.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { get_track, list_tags, list_tracks } from '#query-db/queries.ts'
import type { Envelope } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { PeerError, type ApiPeer, type Track } from '#types/peer.ts'
import { ingest_into, serialise_write, type PeerContext } from './context.ts'
import { append_identity_record } from './identity-library.ts'
import { identity_state, own_recordstore_addresses, visible_addresses } from './ownership.ts'
import { to_api_track, to_api_tracks } from './views.ts'
import { append_write, as_write_refusal, resolve_write_target, type WriteTarget } from './write-target.ts'

// One library's view of a track.
const library_track = (context: PeerContext, { address, track_id }: { address: string, track_id: string }): Track => {
  const row = get_track({ db: context.db, track_id, own_library_addresses: own_recordstore_addresses(context), library_addresses: [address] })
  const track = row === undefined ? undefined : to_api_track(row, identity_state(context).pins)
  if (track === undefined) throw new PeerError('not_found', `not in ${address}: ${track_id}`)
  return track
}

// The envelope a write builds on. Under a capability it is the §3.5.6 base
// entry, which ignores inertness, so the new PUT keeps exactly the tags the
// verifier will check it against.
const live_envelope = (target: WriteTarget, track_id: string): Envelope => {
  const { oplog } = target.handle
  const live = target.capability_id === undefined
    ? get_live_entry({ oplog, key: track_id })
    : resolve_current_state([...oplog.key_entries.get(track_id) ?? []].flatMap((hash) => oplog.entries.get(hash) ?? []))
  if (live === undefined || !is_put(live.operation) || live.operation.value.type !== 'track') {
    throw new PeerError('not_found', `not in ${target.address}: ${track_id}`)
  }
  return live.operation.value
}

// Relabelling appends a new PUT of the same content with the new tags (§2.4.3).
const relabel = async (context: PeerContext, { track_id, library_address, capability_id, tags }: {
  track_id: string
  library_address?: string | undefined
  capability_id?: string | undefined
  tags: (current: readonly string[]) => readonly string[] | undefined
}): Promise<Track> =>
  await serialise_write(context, async () => {
    const target = resolve_write_target(context, { library_address, capability_id })
    const envelope = live_envelope(target, track_id)
    const next = tags(envelope.tags ?? [])
    if (next !== undefined) {
      const payload = build_put_operation({
        envelope: build_track_envelope({ id: envelope.id, content_cid: envelope.content, tags: next }),
        capability_id: target.capability_id
      })
      await append_write(context, target, payload)
    }
    return library_track(context, { address: target.address, track_id })
  })

// content.tags with each given field set, or removed by null. The
// fingerprint derives the track id, so it never changes.
const corrected_tags = (current: Record<string, unknown>, changes: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const fingerprint = current.acoustid_fingerprint
  if (Object.hasOwn(changes, 'acoustid_fingerprint') && changes.acoustid_fingerprint !== fingerprint) {
    throw new PeerError('invalid', 'acoustid_fingerprint derives the track id and cannot change')
  }
  const tags = { ...current }
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) delete tags[name]
    else tags[name] = value
  }
  return tags
}

// A pin keys on the canonical CID (§4.8.2); a string that is no CID is the
// request's error.
const pin_key_of = (cid: string): string => {
  try {
    return canonical_cid(cid)
  } catch {
    throw new PeerError('invalid', `not a CID: ${cid}`)
  }
}

export const create_track_methods = (context: PeerContext): Pick<ApiPeer,
  'list_tracks' | 'add_track' | 'update_track' | 'remove_track' | 'pin_track' | 'unpin_track' | 'list_tags' | 'add_tag' | 'remove_tag' | 'get_audio' | 'has_audio'> => ({
  list_tracks: async ({ library_addresses, ...query }) => {
    const { items, total } = list_tracks({
      db: context.db,
      own_library_addresses: own_recordstore_addresses(context),
      library_addresses: library_addresses ?? visible_addresses(context),
      ...query
    })
    return { items: to_api_tracks(items, identity_state(context).pins), total }
  },

  // CID ingest (§6.4.3): the content object must already be stored locally.
  add_track: async ({ content_cid, library_address, capability_id }) => {
    const target = resolve_write_target(context, { library_address, capability_id })
    let track_id: string
    try {
      // Nothing to prepare: the content object is already stored.
      track_id = (await ingest_into(context, target, {
        prepare: async () => undefined,
        commit: async ({ target: track_target }) => await ingest_cid({ content_cid, target: track_target }),
        blobs: () => []
      })).track_id
    } catch (error) {
      if (error instanceof ProtocolError && error.code === 'content_unavailable') throw new PeerError('not_found', error.message)
      throw as_write_refusal(error)
    }
    return library_track(context, { address: target.address, track_id })
  },

  // A content.tags correction (§2.4.3): a new content object for the same
  // audio, PUT under the same id with the envelope's labels kept.
  update_track: async ({ track_id, tags, library_address, capability_id }) =>
    await serialise_write(context, async () => {
      const target = resolve_write_target(context, { library_address, capability_id })
      const envelope = live_envelope(target, track_id)
      const stored = await context.content_store.get(envelope.content)
      if (stored === undefined) throw new PeerError('conflict', `the content payload of ${track_id} is not stored on this node`)
      const content = validate_track_content(decode_payload(stored))
      const bytes = encode_canonical(validate_track_content({ ...content, tags: corrected_tags(content.tags as Record<string, unknown>, tags) }))
      assert_payload_size(bytes)
      const content_cid = compute_cid_string(bytes)
      if (content_cid !== envelope.content) {
        await context.content_store.put(content_cid, bytes)
        const payload = build_put_operation({
          envelope: build_track_envelope({ id: envelope.id, content_cid, ...(envelope.tags === undefined ? {} : { tags: envelope.tags }) }),
          capability_id: target.capability_id
        })
        await append_write(context, target, payload)
      }
      return library_track(context, { address: target.address, track_id })
    }),

  // No capability action authorises a DEL (§3.5.6), so only an owner removes.
  remove_track: async ({ track_id, library_address }) => {
    await serialise_write(context, async () => {
      const target = resolve_write_target(context, { library_address })
      live_envelope(target, track_id)
      await append_write(context, target, build_del_operation({ key: track_id, type: 'track' }))
    })
  },

  pin_track: async (cid) => {
    const key = pin_key_of(cid)
    await serialise_write(context, async () => {
      if (identity_state(context).pins.has(key)) return
      await append_identity_record(context, build_identity_put({ type: 'pin', v: 1, timestamp: Date.now(), cid: key }))
    })
  },

  unpin_track: async (cid) => {
    const key = pin_key_of(cid)
    await serialise_write(context, async () => {
      if (!identity_state(context).pins.has(key)) throw new PeerError('not_found', `not pinned: ${cid}`)
      await append_identity_record(context, build_identity_del({ type: 'pin', key: identity_record_key({ type: 'pin', v: 1, timestamp: 0, cid: key }) }))
    })
  },

  list_tags: async ({ library_addresses }) => list_tags({ db: context.db, library_addresses: library_addresses ?? visible_addresses(context) }),

  add_tag: async ({ track_id, tag, library_address, capability_id }) => await relabel(context, {
    track_id,
    library_address,
    capability_id,
    tags: (current) => {
      if (current.includes(tag)) throw new PeerError('conflict', `already tagged ${tag}: ${track_id}`)
      return [...current, tag]
    }
  }),

  remove_tag: async ({ track_id, tag, library_address, capability_id }) => await relabel(context, {
    track_id,
    library_address,
    capability_id,
    tags: (current) => current.includes(tag) ? current.filter((label) => label !== tag) : undefined
  }),

  get_audio: async (cid) => await context.audio.read(cid),
  has_audio: async (cid) => await context.audio.read_local(cid) !== undefined
})
