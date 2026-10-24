// The library PUT path for a track (§6.4.1 step 13), shared by local and CID
// ingest: store the content, append the PUT, and pin both.

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { assert_payload_size } from '#encoding/size-bounds.ts'
import { build_track_envelope } from '#entry/envelope.ts'
import { compute_track_id } from '#entry/id.ts'
import { build_labels_put, build_put_operation, is_put } from '#entry/operations.ts'
import { decode_payload, resolver_key, validate_track_content } from '#entry/payload.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { append_entry, get_live_entry, sign_local_entry, type Oplog } from '#oplog/dag.ts'
import type { LabelPair } from '#types/entry.ts'
import type { IngestedTrack } from '#types/ingest.ts'

// The library a track goes into, with the writer key, the store behind it,
// and the capability the write is made under when the writer is not an owner.
export interface TrackTarget {
  readonly oplog: Oplog
  readonly key_pair: KeyPair
  readonly content_store: ContentStore
  readonly capability_id?: string | undefined
}

const describe_entry = ({ entry, existing }: { entry: VerifiedEntry, existing: boolean }): IngestedTrack | undefined =>
  is_put(entry.operation)
    ? { track_id: entry.operation.key, content_cid: entry.operation.value.content, entry_hash: entry.hash, existing }
    : undefined

// The pairs one label record sets and unsets (§2.5), each already checked
// against the library's state, so neither holds a no-op pair.
export interface LabelDiff {
  readonly set: readonly LabelPair[]
  readonly unset: readonly LabelPair[]
}

export const is_empty_diff = ({ set, unset }: LabelDiff): boolean => set.length + unset.length === 0

// A track appended with the label record that follows its PUT in one batch.
export type LabelledTrack = IngestedTrack & { readonly label_entry_hash?: string | undefined }

// The label record of a diff as the target writes it, under its capability.
export const labels_payload = (target: TrackTarget, diff: LabelDiff): unknown =>
  build_labels_put({ set: diff.set, unset: diff.unset, capability_id: target.capability_id })

// Signs and verifies a payload without appending it, so a refusal surfaces
// before anything it would follow is appended.
export const check_payload = (target: TrackTarget, payload: unknown): void => {
  sign_local_entry({ oplog: target.oplog, payload, key_pair: target.key_pair })
}

// Appends one label record and pins its entry block, as put_track does a PUT.
export const put_labels = async ({ target, payload }: { target: TrackTarget, payload: unknown }): Promise<string> => {
  const entry = append_entry({ oplog: target.oplog, key_pair: target.key_pair, payload })
  await target.content_store.put(entry.hash, entry.bytes)
  await target.content_store.pin(entry.hash)
  return entry.hash
}

// The library's live entry for a track id, if any (§6.4.1 step 3).
export const find_existing_track = ({ oplog, track_id }: { oplog: Oplog, track_id: string }): IngestedTrack | undefined => {
  const live = get_live_entry({ oplog, key: track_id })
  return live === undefined ? undefined : describe_entry({ entry: live, existing: true })
}

// The existing entry's stored content.audio.duration, read as written, or
// undefined when it is absent, null, or its content is not stored locally.
export const stored_track_duration = async ({ content_store, content_cid }: {
  content_store: ContentStore
  content_cid: string
}): Promise<number | undefined> => {
  const bytes = await content_store.get(content_cid)
  if (bytes === undefined) return undefined
  const audio = validate_track_content(decode_payload(bytes)).audio as Record<string, unknown>
  return typeof audio.duration === 'number' ? audio.duration : undefined
}

// The content is validated against §2.4.1 before anything is stored.
export const put_track = async ({ target, content, timestamp }: {
  target: TrackTarget
  content: Record<string, unknown>
  timestamp?: number | undefined
}): Promise<IngestedTrack> => {
  const { oplog, key_pair, content_store, capability_id } = target
  const track_content = validate_track_content(content)
  const track_id = compute_track_id((track_content.tags as Record<string, unknown>).acoustid_fingerprint as string)
  // a-c: the content as canonical dag-cbor with sha3-512, pinned non-recursively.
  const bytes = encode_canonical(track_content)
  assert_payload_size(bytes)
  const content_cid = compute_cid_string(bytes)
  await content_store.put(content_cid, bytes)
  await content_store.pin(content_cid)
  // d-e: the PUT keyed by the envelope id, signed and appended.
  const envelope = build_track_envelope({ id: track_id, content_cid, ...(timestamp === undefined ? {} : { timestamp }) })
  const entry = append_entry({ oplog, key_pair, payload: build_put_operation({ envelope, capability_id }) })
  // f: the entry block, pinned non-recursively.
  await content_store.put(entry.hash, entry.bytes)
  await content_store.pin(entry.hash)
  return describe_entry({ entry, existing: false }) as IngestedTrack
}

// Records a source pointer on a live track (§2.4.2): a PUT of the same audio
// with the pointer added to content.resolver. A pointer already present, or
// content not stored locally, appends nothing.
export const add_track_resolver = async ({ target, track_id, resolver }: {
  target: TrackTarget
  track_id: string
  resolver: { readonly extractor: string, readonly id: string }
}): Promise<IngestedTrack | undefined> => {
  const live = get_live_entry({ oplog: target.oplog, key: track_id })
  if (live === undefined || !is_put(live.operation)) return undefined
  const envelope = live.operation.value
  const bytes = await target.content_store.get(envelope.content)
  if (bytes === undefined) return undefined
  const content = validate_track_content(decode_payload(bytes))
  const resolvers = content.resolver as ReadonlyArray<{ extractor: string, id: string }>
  const key = resolver_key(resolver)
  if (resolvers.some((existing) => resolver_key(existing) === key)) return undefined
  return await put_track({ target, content: { ...content, resolver: [...resolvers, { ...resolver }] } })
}
