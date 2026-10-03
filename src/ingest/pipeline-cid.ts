// CID ingest (§6.4.3): adopt a track whose content object is already known
// by CID, bypassing fingerprinting and metadata extraction.

import { parse_cid } from '#encoding/cid.ts'
import { compute_track_id } from '#entry/id.ts'
import { decode_payload, validate_track_content } from '#entry/payload.ts'
import { ProtocolError } from '#types/errors.ts'
import type { IngestedTrack } from '#types/ingest.ts'
import { find_existing_track, put_track, type TrackTarget } from './put-track.ts'

// The content object must already be in the local store; fetching it from
// the network is the replication engine's job. Its §2.4.1 required fields are
// validated before anything is appended.
export const ingest_cid = async ({ content_cid, target, tags, timestamp }: {
  content_cid: string
  target: TrackTarget
  tags?: readonly string[]
  timestamp?: number
}): Promise<IngestedTrack> => {
  parse_cid(content_cid)
  const bytes = await target.content_store.get(content_cid)
  if (bytes === undefined) throw new ProtocolError('content_unavailable', `content object not stored: ${content_cid}`)
  const content = validate_track_content(decode_payload(bytes))
  const track_id = compute_track_id((content.tags as Record<string, unknown>).acoustid_fingerprint as string)
  const existing = find_existing_track({ oplog: target.oplog, track_id })
  if (existing !== undefined) return existing
  return await put_track({ target, content, tags, timestamp })
}
