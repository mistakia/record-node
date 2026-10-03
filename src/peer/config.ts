// Peer configuration: tool paths and pins, protocol tuning floors, and the
// data directory. Every field has a default, so {} is a valid configuration.

import { join } from 'node:path'

import { DEFAULT_NETWORK_CONFIG, type NetworkConfig } from '#adapter/libp2p/config.ts'
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
  // Ingest prepares (decode, tag strip, blob import) that run at once across
  // imports; commits stay one at a time.
  readonly ingest_prepare_concurrency: number
  // §5.4.2: in-flight fetches per library, and each fetch's timeout.
  readonly traversal_concurrency: number
  readonly traversal_timeout_ms: number
  // Playback of audio not held locally (chapter 8, §8.6.5a): how long one
  // GET may wait on peers, and the byte cap on fetched blocks no pin holds,
  // evicted least recently used first.
  readonly audio_fetch_timeout_ms: number
  readonly audio_cache_max_bytes: number
  // §5.4.6: how long one audio or artwork blob a policy or pin keeps may take
  // to fetch before it is retried under backoff.
  readonly blob_fetch_timeout_ms: number
  // §5.4.1 heads coalescing and §5.3.3 announcement rate limit, never below
  // the spec's 1000 ms and 5 s.
  readonly heads_interval_ms: number
  readonly announce_interval_ms: number
  // The §5.5.1 libp2p network, or false for a peer that never connects.
  readonly network: NetworkConfig | false
}

export const HEADS_INTERVAL_FLOOR_MS = 1000
export const ANNOUNCE_INTERVAL_FLOOR_MS = 5000

export const DEFAULT_PEER_CONFIG: PeerConfig = Object.freeze({
  ffmpeg_path: 'ffmpeg',
  fpcalc_path: 'fpcalc',
  allow_toolchain_mismatch: false,
  ingest_prepare_concurrency: 8,
  traversal_concurrency: 4,
  traversal_timeout_ms: 30_000,
  audio_fetch_timeout_ms: 30_000,
  audio_cache_max_bytes: 512 * 1024 * 1024,
  blob_fetch_timeout_ms: 10 * 60_000,
  heads_interval_ms: HEADS_INTERVAL_FLOOR_MS,
  announce_interval_ms: ANNOUNCE_INTERVAL_FLOOR_MS,
  network: DEFAULT_NETWORK_CONFIG
})

const STRING_FIELDS = ['ffmpeg_path', 'fpcalc_path'] as const
const OPTIONAL_STRING_FIELDS = ['data_dir', 'ytdlp_path'] as const

const is_string_list = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

// A partial network object fills in from the defaults.
const resolve_network_config = (network: unknown): NetworkConfig | false => {
  if (network === false) return false
  if (network === null || typeof network !== 'object' || Array.isArray(network)) throw new TypeError('network must be false or an object')
  const resolved = { ...DEFAULT_NETWORK_CONFIG, ...network } as Record<string, unknown>
  const unknown = Object.keys(resolved).filter((key) => !(key in DEFAULT_NETWORK_CONFIG))
  if (unknown.length > 0) throw new TypeError(`network has unknown keys: ${unknown.join(', ')}`)
  for (const field of ['listen', 'bootstrap'] as const) {
    if (!is_string_list(resolved[field])) throw new TypeError(`network.${field} must be an array of multiaddr strings`)
  }
  for (const field of ['mdns', 'dht'] as const) {
    if (typeof resolved[field] !== 'boolean') throw new TypeError(`network.${field} must be true or false`)
  }
  return Object.freeze(resolved) as unknown as NetworkConfig
}

// Checks every value's type, since a config file is untyped JSON: a string
// "false" must never enable allow_toolchain_mismatch.
export const resolve_peer_config = (config: Partial<PeerConfig> = {}): PeerConfig => {
  const resolved = { ...DEFAULT_PEER_CONFIG, ...config }
  for (const field of STRING_FIELDS) {
    if (typeof resolved[field] !== 'string' || resolved[field] === '') throw new TypeError(`${field} must be a non-empty string`)
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (resolved[field] !== undefined && typeof resolved[field] !== 'string') throw new TypeError(`${field} must be a string`)
  }
  if (typeof resolved.allow_toolchain_mismatch !== 'boolean') throw new TypeError('allow_toolchain_mismatch must be true or false')
  for (const field of ['ingest_prepare_concurrency', 'traversal_concurrency', 'traversal_timeout_ms', 'audio_fetch_timeout_ms', 'audio_cache_max_bytes', 'blob_fetch_timeout_ms', 'heads_interval_ms', 'announce_interval_ms'] as const) {
    if (!Number.isSafeInteger(resolved[field]) || resolved[field] <= 0) {
      throw new RangeError(`${field} must be a positive integer, not ${String(resolved[field])}`)
    }
  }
  if (resolved.heads_interval_ms < HEADS_INTERVAL_FLOOR_MS) throw new RangeError(`heads_interval_ms must be at least ${HEADS_INTERVAL_FLOOR_MS}`)
  if (resolved.announce_interval_ms < ANNOUNCE_INTERVAL_FLOOR_MS) throw new RangeError(`announce_interval_ms must be at least ${ANNOUNCE_INTERVAL_FLOOR_MS}`)
  return Object.freeze({ ...resolved, network: resolve_network_config(resolved.network) })
}

// The data directory layout.
export const data_paths = (data_dir: string) => ({
  blocks: join(data_dir, 'blocks'),
  datastore: join(data_dir, 'datastore'),
  // Pin counts (#fabric/pin-index.ts), derived and refilled at open.
  pins: join(data_dir, 'pins.sqlite'),
  identity: join(data_dir, 'identity.key'),
  libraries: join(data_dir, 'libraries.json'),
  // The persisted query index (§4.7): reopened across restarts so the library
  // is not re-projected from blocks every time.
  index: join(data_dir, 'index.sqlite')
})
