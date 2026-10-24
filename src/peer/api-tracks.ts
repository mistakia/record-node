// ApiPeer track, tag, pin, audio, and image methods. Writes go to a write target:
// an own library, or one written under a capability (chapter 7).

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { assert_payload_size } from '#encoding/size-bounds.ts'
import { build_track_envelope } from '#entry/envelope.ts'
import { build_identity_del, build_identity_put, canonical_cid, identity_record_key } from '#entry/identity-record.ts'
import { build_del_operation, build_put_operation, is_put } from '#entry/operations.ts'
import { decode_payload, validate_track_content } from '#entry/payload.ts'
import { ingest_cid } from '#ingest/pipeline-cid.ts'
import { blob_decoded_fields, with_decoded_fields } from '#ingest/rederive.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { get_track, list_tags, list_tracks } from '#query-db/queries.ts'
import type { Envelope } from '#types/entry.ts'
import { ProtocolError } from '#types/errors.ts'
import { IngestError } from '#types/ingest.ts'
import { PeerError, type ApiPeer, type LabelChange, type Track } from '#types/peer.ts'
import { ingest_into, require_toolchain, serialise_write, type PeerContext } from './context.ts'
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

// The live envelope a write builds on.
const live_envelope = (target: WriteTarget, track_id: string): Envelope => {
  const live = get_live_entry({ oplog: target.handle.oplog, key: track_id })
  if (live === undefined || !is_put(live.operation)) {
    throw new PeerError('not_found', `not in ${target.address}: ${track_id}`)
  }
  return live.operation.value
}

// A label change as the API takes it: set, or add and remove, with no label
// both added and removed.
const checked_label_change = ({ add, remove, set }: LabelChange): LabelChange => {
  if (add === undefined && remove === undefined && set === undefined) throw new PeerError('invalid', 'a label change gives add, remove, or set')
  if (set !== undefined && (add !== undefined || remove !== undefined)) throw new PeerError('invalid', 'set replaces the labels, so it excludes add and remove')
  const both = (add ?? []).find((label) => (remove ?? []).includes(label))
  if (both !== undefined) throw new PeerError('invalid', `a label is both added and removed: ${both}`)
  return { add, remove, set }
}

// Labels are label records (§2.5), never envelope tags, and this build does
// not write label records yet, so every label write is refused.
const refuse_label_write = (): never => {
  throw new PeerError('conflict', 'label writes are unavailable: labels are label records (§2.5), which this build does not write yet')
}

// The live entry's content payload, which a correction rewrites.
const stored_content = async (context: PeerContext, { envelope, track_id }: { envelope: Envelope, track_id: string }): Promise<Record<string, unknown>> => {
  const stored = await context.content_store.get(envelope.content)
  if (stored === undefined) throw new PeerError('conflict', `the content payload of ${track_id} is not stored on this node`)
  return validate_track_content(decode_payload(stored))
}

// A correction (§2.4.3, §6.4.4): a new content object for the same audio, PUT
// under the same id. The same content appends nothing.
const supersede_content = async (context: PeerContext, { target, envelope, content }: {
  target: WriteTarget
  envelope: Envelope
  content: Record<string, unknown>
}): Promise<void> => {
  const bytes = encode_canonical(validate_track_content(content))
  assert_payload_size(bytes)
  const content_cid = compute_cid_string(bytes)
  if (content_cid === envelope.content) return
  await context.content_store.put(content_cid, bytes)
  const payload = build_put_operation({
    envelope: build_track_envelope({ id: envelope.id, content_cid }),
    capability_id: target.capability_id
  })
  await append_write(context, target, payload)
}

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
  'list_tracks' | 'add_track' | 'update_track' | 'rederive_track' | 'remove_track' | 'pin_track' | 'unpin_track' | 'list_tags' | 'add_tag' | 'remove_tag' |
  'change_labels' | 'change_labels_batch' | 'get_audio' | 'has_audio' | 'get_image'> => ({
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
  // A new track carries the given labels in its PUT, and a held one is
  // relabelled to them.
  add_track: async ({ content_cid, tags, library_address, capability_id }) => {
    if (tags !== undefined && tags.length > 0) refuse_label_write()
    const target = resolve_write_target(context, { library_address, capability_id })
    let track_id: string
    try {
      // Nothing to prepare: the content object is already stored.
      ({ track_id } = await ingest_into(context, target, {
        prepare: async () => undefined,
        commit: async ({ target: track_target }) => await ingest_cid({ content_cid, target: track_target }),
        blobs: () => []
      }))
    } catch (error) {
      if (error instanceof ProtocolError && error.code === 'content_unavailable') throw new PeerError('not_found', error.message)
      throw as_write_refusal(error)
    }
    return library_track(context, { address: target.address, track_id })
  },

  // A content.tags correction (§2.4.3): a new content object for the same
  // audio, PUT under the same id.
  update_track: async ({ track_id, tags, library_address, capability_id }) =>
    await serialise_write(context, async () => {
      const target = resolve_write_target(context, { library_address, capability_id })
      const envelope = live_envelope(target, track_id)
      const content = await stored_content(context, { envelope, track_id })
      await supersede_content(context, { target, envelope, content: { ...content, tags: corrected_tags(content.tags as Record<string, unknown>, tags) } })
      return library_track(context, { address: target.address, track_id })
    }),

  // Audio re-derivation (§6.4.4). The blob decodes outside the write lock,
  // and the fields apply to whatever content is live once it is held, so a
  // concurrent tag correction is kept.
  rederive_track: async ({ track_id, library_address, capability_id }) => {
    const target = resolve_write_target(context, { library_address, capability_id })
    const { hash, size } = await stored_content(context, { envelope: live_envelope(target, track_id), track_id })
    const blob = await context.audio.read_local(hash as string)
    if (blob === undefined) throw new PeerError('conflict', `the audio blob of ${track_id} is not stored on this node`)
    let fields
    try {
      fields = await blob_decoded_fields({ blob, size: size as number, toolchain: await require_toolchain(context) })
    } catch (error) {
      if (error instanceof IngestError) throw new PeerError('conflict', `the audio blob of ${track_id} cannot be decoded: ${error.message}`)
      throw error
    }
    return await serialise_write(context, async () => {
      const envelope = live_envelope(target, track_id)
      const content = await stored_content(context, { envelope, track_id })
      if (content.hash !== hash) throw new PeerError('conflict', `the audio of ${track_id} changed while it was decoded`)
      const rederived = with_decoded_fields(content, fields)
      if (rederived !== undefined) await supersede_content(context, { target, envelope, content: rederived })
      return library_track(context, { address: target.address, track_id })
    })
  },

  // No capability action authorises a DEL (§3.5.6), so only an owner removes.
  remove_track: async ({ track_id, library_address }) => {
    await serialise_write(context, async () => {
      const target = resolve_write_target(context, { library_address })
      live_envelope(target, track_id)
      await append_write(context, target, build_del_operation({ key: track_id }))
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

  list_tags: async ({ library_addresses, prefix }) => list_tags({ db: context.db, library_addresses: library_addresses ?? visible_addresses(context), prefix }),

  add_tag: async () => refuse_label_write(),
  remove_tag: async () => refuse_label_write(),

  change_labels: async ({ add, remove, set }) => {
    checked_label_change({ add, remove, set })
    return refuse_label_write()
  },

  change_labels_batch: async ({ items }) => {
    for (const { add, remove, set } of items) checked_label_change({ add, remove, set })
    return refuse_label_write()
  },

  get_audio: async (cid) => await context.audio.read(cid),
  has_audio: async (cid) => await context.audio.read_local(cid) !== undefined,
  get_image: async (cid, { local_only = false } = {}) => local_only ? await context.images.read_local(cid) : await context.images.read(cid)
})
