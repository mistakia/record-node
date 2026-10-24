// CID ingest (§6.4.3): adopt a track whose content object is already known
// by CID, bypassing fingerprinting and metadata extraction.

import { parse_cid } from '#encoding/cid.ts'
import { compute_track_id } from '#entry/id.ts'
import { decode_payload, validate_track_content } from '#entry/payload.ts'
import { ProtocolError } from '#types/errors.ts'
import {
  check_payload, find_existing_track, is_empty_diff, labels_payload, put_labels, put_track, type LabelDiff, type LabelledTrack, type TrackTarget
} from './put-track.ts'

// The content object must already be in the local store; fetching it from
// the network is the replication engine's job. Its §2.4.1 required fields are
// validated before anything is appended. labels gives the label record to
// append after the track PUT, from the track id, so the track joins with its
// labels; it is checked before the PUT, so a refused record appends nothing.
export const ingest_cid = async ({ content_cid, target, timestamp, labels }: {
  content_cid: string
  target: TrackTarget
  timestamp?: number
  labels?: ((track_id: string) => LabelDiff) | undefined
}): Promise<LabelledTrack> => {
  parse_cid(content_cid)
  const bytes = await target.content_store.get(content_cid)
  if (bytes === undefined) throw new ProtocolError('content_unavailable', `content object not stored: ${content_cid}`)
  const content = validate_track_content(decode_payload(bytes))
  const track_id = compute_track_id((content.tags as Record<string, unknown>).acoustid_fingerprint as string)
  const diff = labels?.(track_id)
  const payload = diff === undefined || is_empty_diff(diff) ? undefined : labels_payload(target, diff)
  if (payload !== undefined) check_payload(target, payload)
  const track = find_existing_track({ oplog: target.oplog, track_id }) ?? await put_track({ target, content, timestamp })
  return payload === undefined ? track : { ...track, label_entry_hash: await put_labels({ target, payload }) }
}
