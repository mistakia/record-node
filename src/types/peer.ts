// The peer surface the HTTP and WebSocket API consumes (src/api/). Peer
// assembly (src/peer/) implements it; the API holds no protocol logic.

import type { ImportEventPayloads } from './ingest.ts'
//
// Values crossing it are the API-layer shapes of record-docs
// spec/7-http-api.yaml (components.schemas), mirrored here for the compiler
// only. The yaml stays the contract: response validation in the API tests
// catches any drift between these types and it.

export interface ResolverEntry {
  extractor: string
  id: string
  fulltitle?: string
  thumbnail?: string
  artist?: string
  alt_title?: string
  upload_date?: string
  webpage_url?: string
  duration?: number
}

export interface TrackTag {
  library_address: string
  tag: string
}

export interface Track {
  id: string
  content_cid: string
  audio_cid: string
  audio_size_bytes: number
  title?: string | null
  artist?: string | null
  artists?: string[]
  album?: string | null
  album_artist?: string | null
  remixer?: string | null
  genre?: string[]
  bpm?: number | null
  duration_seconds?: number | null
  bitrate?: number | null
  codec?: string | null
  sample_rate?: number | null
  lossless?: boolean | null
  artwork?: string[]
  resolvers?: ResolverEntry[]
  tags: TrackTag[]
  listen_count: number
  listen_timestamps_ms?: number[]
  have_track: boolean
  added_at_ms?: number
}

export interface TrackList {
  items: Track[]
  total: number
}

export interface TagCount {
  tag: string
  count: number
}

export interface ReplicationStatus {
  progress: number
  total: number
}

export interface Library {
  id: string
  address: string
  name?: string | null
  bio?: string | null
  location?: string | null
  avatar?: string | null
  alias?: string | null
  track_count: number
  linked_library_count: number
  length: number
  replication_status: ReplicationStatus
  is_replicating: boolean
  is_loading_index: boolean
  is_processing_index: boolean
  is_linked: boolean
  is_own: boolean
  peer_ids: string[]
}

export interface About {
  library_address: string
  name?: string | null
  bio?: string | null
  location?: string | null
  avatar?: string | null
}

// The mutable About fields; an omitted field stays unchanged.
export type AboutUpdate = Partial<Omit<About, 'library_address'>>

export interface ListenCount {
  track_id: string
  count: number
  timestamps_ms?: number[]
}

export interface PeerInfo {
  peer_id: string
  multiaddrs: string[]
  library_addresses?: string[]
  connected_at_ms?: number
}

export interface Settings {
  peer_id: string
  addresses?: string[]
  version?: string
  bandwidth?: {
    total_in_bytes?: string
    total_out_bytes?: string
    rate_in_bytes_per_sec?: string
    rate_out_bytes_per_sec?: string
  }
  storage?: {
    used_bytes?: number
    max_bytes?: number
    object_count?: number
  }
}

export interface IdentityExport {
  public_key: string
  private_key: string
}

export interface ImportedIdentity {
  id: string
  public_key: string
  own_library_address: string
}

export type TrackSort = 'title' | 'artist' | 'album' | 'bpm' | 'duration' | 'added_at'

export interface TrackQuery {
  offset: number
  limit: number
  library_addresses?: string[]
  tags?: string[]
  query?: string
  shuffle: boolean
  sort: TrackSort
  order: 'asc' | 'desc'
}

// Ingest progress as the import:* WebSocket events of 7-http-api.yaml. The
// ingest contract (src/types/ingest.ts) is the source: starting and finished
// pass through, while processed-file carries the indexed API Track and error
// carries the spec's Error envelope. file_count is reported for multipart
// imports only.
export interface ImportAck {
  import_id: string
  file_count?: number
}

export type ImportEvent =
  | { type: 'import:starting', payload: ImportEventPayloads['import:starting'] }
  | { type: 'import:processed-file', payload: { import_id: string, file_path: string, track: Track, completed: number, remaining: number } }
  | { type: 'import:error', payload: { import_id: string, file_path: string, error: { error: { code: string, message: string } } } }
  | { type: 'import:finished', payload: ImportEventPayloads['import:finished'] }

// Every other x-websocket-events type. Peer assembly maps oplog, pubsub,
// replicator, and library-lifecycle callbacks onto these.
export type LibraryEventType =
  | 'track:added' | 'track:removed'
  | 'library:linked' | 'library:unlinked'
  | 'library:connected' | 'library:disconnected'
  | 'library:loading' | 'library:loaded'
  | 'library:replicated' | 'library:replicate-progress' | 'library:index-updated'
  | 'library:peer-joined' | 'library:peer-left'
  | 'peer:joined' | 'peer:left'

export type PeerEvent = ImportEvent | { type: LibraryEventType, payload: Record<string, unknown> }

// Domain failures a route maps to a status. A ProtocolError from the peer is
// the caller's input failing a protocol rule, and maps to 400, as does
// invalid: input the peer refuses outside the protocol, such as a URL the
// resolver cannot handle.
export type PeerErrorCode = 'not_found' | 'conflict' | 'forbidden' | 'invalid'

export class PeerError extends Error {
  readonly code: PeerErrorCode

  constructor (code: PeerErrorCode, message: string) {
    super(message)
    this.name = 'PeerError'
    this.code = code
  }
}

export interface ApiPeer {
  list_tracks: (query: TrackQuery) => Promise<TrackList>
  // Adopts a track known by its content CID into the own library.
  add_track: (content_cid: string) => Promise<Track>
  remove_track: (track_id: string) => Promise<void>

  list_tags: (filter: { library_addresses?: string[] }) => Promise<TagCount[]>
  add_tag: (label: { track_id: string, tag: string }) => Promise<Track>
  remove_tag: (label: { track_id: string, tag: string }) => Promise<Track>

  list_libraries: () => Promise<Library[]>
  get_library: (address: string) => Promise<Library | undefined>
  link_library: (link: { address: string, alias: string | null }) => Promise<Library>
  unlink_library: (address: string) => Promise<void>
  connect_library: (address: string) => Promise<void>
  disconnect_library: (address: string) => Promise<void>
  get_about: (address: string) => Promise<About | undefined>
  // Writes an About entry to the own library; the address is stamped (§2.6).
  set_about: (update: { address: string, fields: AboutUpdate }) => Promise<About>

  list_listens: (page: { offset: number, limit: number }) => Promise<TrackList>
  record_listen: (listen: { track_id: string, library_address: string }) => Promise<ListenCount>

  list_peers: () => Promise<PeerInfo[]>
  get_settings: () => Promise<Settings>
  export_identity: () => Promise<IdentityExport>
  // Generates a new key pair when private_key is absent.
  import_identity: (key: { private_key?: string }) => Promise<ImportedIdentity>

  // The audio blob's file bytes (not its root block), local store only.
  get_audio: (cid: string) => Promise<Uint8Array | undefined>
  has_audio: (cid: string) => Promise<boolean>

  // Ingest takes ownership of the files and removes them when done (§6.4.1).
  import_files: (paths: string[]) => Promise<ImportAck>
  // The §6.4.2 URL pipeline: resolves, downloads, strips resolver.url, ingests.
  import_url: (url: string) => Promise<ImportAck>

  // Callback registration; returns the unsubscribe.
  subscribe: (handler: (event: PeerEvent) => void) => () => void
}

// Resolves a URL to its resolver records without downloading (record-resolver).
// Records are raw extractor output and may carry a streaming url.
export type Resolver = (url: string) => Promise<ReadonlyArray<Record<string, unknown>>>
