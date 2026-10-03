// The library PUT path for a track (§6.4.1 step 13), shared by local and CID
// ingest: store the content, append the PUT, and pin both.

import { encode_canonical } from '#encoding/canonical-bytes.ts'
import { compute_cid_string } from '#encoding/cid.ts'
import { assert_payload_size } from '#encoding/size-bounds.ts'
import { build_track_envelope } from '#entry/envelope.ts'
import { compute_track_id } from '#entry/id.ts'
import { build_put_operation, is_put } from '#entry/operations.ts'
import { validate_track_content } from '#entry/payload.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import { append_entry, get_live_entry, type Oplog } from '#oplog/dag.ts'
import type { IngestedTrack } from '#types/ingest.ts'

// The library a track goes into, with the writer key and the store behind it.
export interface TrackTarget {
  readonly oplog: Oplog
  readonly key_pair: KeyPair
  readonly content_store: ContentStore
}

const describe_entry = ({ entry, existing }: { entry: VerifiedEntry, existing: boolean }): IngestedTrack | undefined =>
  is_put(entry.operation)
    ? { track_id: entry.operation.key, content_cid: entry.operation.value.content, entry_hash: entry.hash, existing }
    : undefined

// The library's live entry for a track id, if any (§6.4.1 step 3).
export const find_existing_track = ({ oplog, track_id }: { oplog: Oplog, track_id: string }): IngestedTrack | undefined => {
  const live = get_live_entry({ oplog, key: track_id })
  return live === undefined ? undefined : describe_entry({ entry: live, existing: true })
}

// The content is validated against §2.4.1 before anything is stored.
export const put_track = async ({ target, content, tags, timestamp }: {
  target: TrackTarget
  content: Record<string, unknown>
  tags?: readonly string[] | undefined
  timestamp?: number | undefined
}): Promise<IngestedTrack> => {
  const { oplog, key_pair, content_store } = target
  const track_content = validate_track_content(content)
  // a-c: the content as canonical dag-cbor with sha3-512, pinned non-recursively.
  const bytes = encode_canonical(track_content)
  assert_payload_size(bytes)
  const content_cid = compute_cid_string(bytes)
  await content_store.put(content_cid, bytes)
  await content_store.pin(content_cid)
  // d-e: the PUT keyed by the envelope id, signed and appended.
  const envelope = build_track_envelope({
    id: compute_track_id((track_content.tags as Record<string, unknown>).acoustid_fingerprint as string),
    content_cid,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(tags === undefined ? {} : { tags })
  })
  const entry = append_entry({ oplog, key_pair, payload: build_put_operation({ envelope }) })
  // f: the entry block, pinned non-recursively.
  await content_store.put(entry.hash, entry.bytes)
  await content_store.pin(entry.hash)
  return describe_entry({ entry, existing: false }) as IngestedTrack
}
