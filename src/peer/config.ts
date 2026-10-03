// Peer configuration: tool paths and pins, protocol tuning floors, and the
// data directory. Every field has a default, so {} is a valid configuration.

import { join } from 'node:path'

import { PINNED_FFMPEG_VERSION, PINNED_FPCALC_VERSION } from '#ingest/toolchain.ts'

// The protocol-bound tool pins (§6.1.5, §6.2.4). The ffmpeg flags and the
// fpcalc algorithm are fixed in src/ingest, not configurable.
export const TOOL_PINS = Object.freeze({
  ffmpeg_version: PINNED_FFMPEG_VERSION,
  fpcalc_version: PINNED_FPCALC_VERSION,
  fpcalc_algorithm: 2
})

export interface PeerConfig {
  // Where blocks, pins, the identity key, and library heads live. Absent,
  // the peer keeps everything in memory and forgets it on stop.
  readonly data_dir?: string | undefined
  readonly ffmpeg_path: string
  readonly fpcalc_path: string
  // yt-dlp for URL ingest (§6.4.2); record-resolver finds it on PATH or
  // YTDLP_PATH when absent.
  readonly ytdlp_path?: string | undefined
  // Development only: ingest on an unpinned ffmpeg or fpcalc.
  readonly allow_toolchain_mismatch: boolean
  // §5.4.2 floors, used by the replication stage.
  readonly traversal_concurrency: number
  readonly traversal_timeout_ms: number
  // §5.4.1 heads coalescing and §5.3.3 announcement rate limit.
  readonly heads_interval_ms: number
  readonly announce_interval_ms: number
}

export const DEFAULT_PEER_CONFIG: PeerConfig = Object.freeze({
  ffmpeg_path: 'ffmpeg',
  fpcalc_path: 'fpcalc',
  allow_toolchain_mismatch: false,
  traversal_concurrency: 4,
  traversal_timeout_ms: 30_000,
  heads_interval_ms: 1000,
  announce_interval_ms: 5000
})

export const resolve_peer_config = (config: Partial<PeerConfig> = {}): PeerConfig => {
  const resolved = { ...DEFAULT_PEER_CONFIG, ...config }
  for (const field of ['traversal_concurrency', 'traversal_timeout_ms', 'heads_interval_ms', 'announce_interval_ms'] as const) {
    if (!Number.isSafeInteger(resolved[field]) || resolved[field] <= 0) {
      throw new RangeError(`${field} must be a positive integer, not ${String(resolved[field])}`)
    }
  }
  return Object.freeze(resolved)
}

// The data directory layout.
export const data_paths = (data_dir: string) => ({
  blocks: join(data_dir, 'blocks'),
  datastore: join(data_dir, 'datastore'),
  identity: join(data_dir, 'identity.key'),
  libraries: join(data_dir, 'libraries.json')
})
