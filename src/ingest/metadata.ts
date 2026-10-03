// Metadata extraction through music-metadata (§6.3, §6.4.1 steps 4-5).
//
// Only the fields §2.4.1 and §6.3 enumerate are persisted. Passthrough of
// other library fields is permitted (MAY) but left out: it would tie the
// dag-cbor content, and so the content CID, to one library's output.

import { parseFile, type IAudioMetadata } from 'music-metadata'

import { IngestError } from '#types/ingest.ts'

export interface ExtractedPicture {
  readonly format: string
  readonly data: Uint8Array
}

export interface ExtractedMetadata {
  readonly tags: Record<string, unknown>
  readonly audio: Record<string, unknown>
  // Embedded artwork in source order, removed from the tags (§6.4.1 step 5).
  readonly pictures: readonly ExtractedPicture[]
}

const is_present = (value: unknown): boolean =>
  value !== undefined && value !== null && !(typeof value === 'number' && !Number.isFinite(value))

// Drops absent fields: unknown is omission, never 0 (§6.3.2).
const present_fields = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => is_present(value)))

const positive = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined

const positive_integer = (value: number | undefined): number | undefined => {
  const finite = positive(value)
  return finite === undefined ? undefined : Math.round(finite)
}

// §2.4.1 types remixer as a string; music-metadata yields a list.
const joined = (values: readonly string[] | undefined): string | undefined =>
  values === undefined || values.length === 0 ? undefined : values.join(', ')

const without_undefined = <T extends object>(value: T): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>

const map_tags = ({ common, fingerprint }: { common: IAudioMetadata['common'], fingerprint: string }) => present_fields({
  acoustid_fingerprint: fingerprint,
  title: common.title,
  artist: common.artist,
  artists: common.artists,
  albumartist: common.albumartist,
  album: common.album,
  remixer: joined(common.remixer),
  bpm: positive(common.bpm),
  genre: common.genre,
  track: common.track,
  disk: common.disk
})

const map_audio = (format: IAudioMetadata['format']) => present_fields({
  bitrate: positive_integer(format.bitrate),
  codec: format.codec,
  container: format.container,
  sampleRate: positive_integer(format.sampleRate),
  numberOfChannels: positive_integer(format.numberOfChannels),
  numberOfSamples: format.numberOfSamples,
  lossless: format.lossless,
  codecProfile: format.codecProfile,
  tagTypes: format.tagTypes,
  trackInfo: format.trackInfo === undefined ? undefined : format.trackInfo.map(without_undefined)
})

// The fingerprint becomes tags.acoustid_fingerprint (§6.3.1). The duration
// written is the decoded one (duration.ts), never the container's.
export const extract_metadata = async ({ file_path, fingerprint }: {
  file_path: string
  fingerprint: string
}): Promise<ExtractedMetadata> => {
  let metadata: IAudioMetadata
  try {
    metadata = await parseFile(file_path, { duration: true })
  } catch (error) {
    throw new IngestError('no_audio', `cannot read audio metadata from ${file_path}: ${(error as Error).message}`)
  }
  const { common, format } = metadata
  const pictures = (common.picture ?? []).map(({ format: picture_format, data }) => ({ format: picture_format, data }))
  return { tags: map_tags({ common, fingerprint }), audio: map_audio(format), pictures }
}
