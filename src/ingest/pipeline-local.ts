// Local file ingest (§6.4.1). Step numbers below are the spec's.
//
// The pipeline runs in two phases so a node can work on several files at
// once. prepare_local_file does everything that depends on the file alone:
// fingerprint, metadata, decode, tag strip, and the blob imports and pins.
// commit_local_file then makes step 3's decision against the library as it
// is at that moment, and appends; a caller serialises commits per library.
// A commit that refuses, or finds the track already there, releases the
// blobs its prepare pinned.

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { compute_track_id } from '#entry/id.ts'
import { IngestError, type IngestedTrack } from '#types/ingest.ts'
import { upload_artwork } from './artwork.ts'
import { decode_audio, decoded_fields, decoded_seconds, type DecodedAudio } from './duration.ts'
import { compute_fingerprint, is_degenerate_fingerprint } from './fingerprint.ts'
import { extract_metadata } from './metadata.ts'
import { find_existing_track, put_track, stored_track_duration, type TrackTarget } from './put-track.ts'
import { strip_tags } from './tag-strip.ts'
import type { Toolchain } from './toolchain.ts'

// Durations within this many seconds count as one recording (§6.4.1 step 3).
export const COLLISION_TOLERANCE_SECONDS = 30

export type PreparedTrack =
  // The library already held the track when the prepare looked.
  | { readonly kind: 'existing', readonly track: IngestedTrack }
  | {
    readonly kind: 'new'
    readonly file_path: string
    readonly track_id: string
    readonly duration: number
    readonly content: Record<string, unknown>
    // The audio and artwork CIDs the prepare pinned.
    readonly blobs: readonly string[]
  }

// Unpins prepared blobs no library holds. The peer supplies one that checks
// every library's pins. Standalone there is no such view, and a blob the
// existing entry shares must never be unpinned, so nothing is released.
export type ReleaseBlobs = (cids: readonly string[]) => Promise<void>

// Step 3: the library's live entry for the id, or undefined. A stored
// duration more than 30 s from the file's refuses the ingest as a collision.
const existing_entry = async ({ target, track_id, file_path, duration }: {
  target: TrackTarget
  track_id: string
  file_path: string
  duration: () => Promise<number>
}): Promise<IngestedTrack | undefined> => {
  const existing = find_existing_track({ oplog: target.oplog, track_id })
  if (existing === undefined) return undefined
  const stored = await stored_track_duration({ content_store: target.content_store, content_cid: existing.content_cid })
  if (stored === undefined) return existing
  const decoded = await duration()
  if (Math.abs(decoded - stored) > COLLISION_TOLERANCE_SECONDS) {
    throw new IngestError('track_id_collision',
      `${file_path} (${decoded.toFixed(1)} s) shares track id ${track_id} with entry ${existing.entry_hash} (${stored} s)`)
  }
  return existing
}

export const prepare_local_file = async ({ file_path, target, toolchain, resolver = [] }: {
  file_path: string
  target: TrackTarget
  toolchain: Toolchain
  // §2.4.2 entries with url already removed (§6.4.2 step 4); a url is rejected.
  resolver?: readonly Record<string, unknown>[]
}): Promise<PreparedTrack> => {
  const { content_store } = target
  // 1-2: fingerprint the original file, never the stripped copy, and refuse
  // a degenerate one, which silence or a steady tone yields (§6.1.6).
  const fingerprint = await compute_fingerprint({ file_path, toolchain })
  if (is_degenerate_fingerprint(fingerprint)) {
    throw new IngestError('degenerate_fingerprint', `${file_path} fingerprints to a degenerate value, as a silent or steady-tone opening does`)
  }
  const track_id = compute_track_id(fingerprint)
  let decoding: Promise<DecodedAudio> | undefined
  const decoded = async () => await (decoding ??= decode_audio({ file_path, toolchain }))
  const duration = async () => decoded_seconds(await decoded())
  // 3, early: a repeat skips the rest of the work. The commit decides again.
  const existing = await existing_entry({ target, track_id, file_path, duration })
  if (existing !== undefined) return { kind: 'existing', track: existing }
  // 4-5: metadata, with artwork split out, and the decode, before anything is
  // imported. The decoded fields replace the container's once the blob is
  // measured (§6.3.2).
  const metadata = await extract_metadata({ file_path, fingerprint })
  const { tags: content_tags, pictures } = metadata
  const audio_decoded = await decoded()
  // The stripped copy keeps the source extension, which selects the container.
  const extension = extname(file_path)
  if (extension === '') throw new IngestError('tool_failed', `${file_path} has no file extension to select the output container`)
  const temp_dir = await mkdtemp(join(tmpdir(), 'record-ingest-'))
  try {
    // 6-7: strip tags into the temp dir and import the result.
    const stripped_path = join(temp_dir, `stripped${extension}`)
    await strip_tags({ input_path: file_path, output_path: stripped_path, toolchain })
    const audio_cid = await content_store.import_blob(stripped_path)
    // 8: artwork, in source order.
    const artwork = await upload_artwork({ pictures, content_store })
    // 9-10: measure the blob and assemble track.content.
    const { size } = await stat(stripped_path)
    const audio = { ...metadata.audio, ...decoded_fields(audio_decoded, size) }
    const content = { hash: audio_cid, size, tags: content_tags, audio, artwork, resolver: [...resolver] }
    // 11: the audio blob and artwork are UnixFS DAGs, so pinned recursively.
    const blobs = [audio_cid, ...artwork]
    for (const cid of blobs) await content_store.pin(cid, { recursive: true })
    return { kind: 'new', file_path, track_id, duration: audio.duration, content, blobs }
  } finally {
    // 14: remove the temporary tag-stripped file.
    await rm(temp_dir, { recursive: true, force: true })
  }
}

export const commit_local_file = async ({ prepared, target, release, tags, timestamp }: {
  prepared: PreparedTrack
  target: TrackTarget
  release: ReleaseBlobs
  tags?: readonly string[] | undefined
  timestamp?: number | undefined
}): Promise<IngestedTrack> => {
  if (prepared.kind === 'existing') return prepared.track
  try {
    // 3, authoritative: another commit may have added the id since the prepare.
    const existing = await existing_entry({ target, track_id: prepared.track_id, file_path: prepared.file_path, duration: async () => prepared.duration })
    if (existing !== undefined) {
      await release(prepared.blobs)
      return existing
    }
    // 12-13: envelope, PUT, sign, append, and pin.
    return await put_track({ target, content: prepared.content, tags, timestamp })
  } catch (error) {
    await release(prepared.blobs)
    throw error
  }
}

export const prepared_blobs = (prepared: PreparedTrack): readonly string[] => prepared.kind === 'new' ? prepared.blobs : []

// Both phases back to back, for a caller with one file and nothing to overlap.
export const ingest_local_file = async ({ file_path, target, toolchain, resolver, tags, timestamp, release }: {
  file_path: string
  target: TrackTarget
  toolchain: Toolchain
  resolver?: readonly Record<string, unknown>[]
  tags?: readonly string[]
  timestamp?: number
  release?: ReleaseBlobs
}): Promise<IngestedTrack> => {
  const prepared = await prepare_local_file({ file_path, target, toolchain, ...(resolver === undefined ? {} : { resolver }) })
  return await commit_local_file({ prepared, target, release: release ?? (async () => {}), tags, timestamp })
}
