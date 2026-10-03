// Ingest results, ingest errors, and the import progress contract (§6.4).
// The API layer turns import events into the import:* WebSocket events of
// 7-http-api.yaml; the protocol layer owns import_id.

export type IngestErrorCode =
  | 'toolchain_unavailable'
  | 'toolchain_mismatch'
  | 'tool_failed'
  | 'no_audio'
  | 'empty_fingerprint'
  | 'degenerate_fingerprint'
  | 'track_id_collision'
  | 'invalid_duration'
  | 'non_audio_stream'
  | 'download_failed'

export class IngestError extends Error {
  readonly code: IngestErrorCode

  constructor (code: IngestErrorCode, message: string) {
    super(message)
    this.name = 'IngestError'
    this.code = code
  }
}

// One ingested track. existing is true when the library already held a live
// entry for the track id and nothing was appended (§6.4.1 step 3).
export interface IngestedTrack {
  readonly track_id: string
  readonly content_cid: string
  readonly entry_hash: string
  readonly existing: boolean
}

export type ImportSource = 'file' | 'url'

// The ImportAck of 7-http-api.yaml, returned before any file is processed.
export interface ImportAck {
  readonly import_id: string
  readonly file_count: number
}

export interface ImportEventPayloads {
  'import:starting': {
    readonly import_id: string
    readonly source: ImportSource
    readonly file_count: number
  }
  // completed counts every settled file, failed ones included.
  'import:processed-file': {
    readonly import_id: string
    readonly file_path: string
    readonly track: IngestedTrack
    readonly completed: number
    readonly remaining: number
  }
  // One file failed; the import continues. code is an IngestErrorCode or
  // ProtocolErrorCode when the failure carries one, otherwise 'internal'.
  'import:error': {
    readonly import_id: string
    readonly file_path: string
    readonly error: { readonly code: string, readonly message: string }
    readonly completed: number
    readonly remaining: number
  }
  'import:finished': {
    readonly import_id: string
    readonly track_count: number
    readonly error_count: number
  }
}

export type ImportEventType = keyof ImportEventPayloads

export type ImportEventHandler<T extends ImportEventType> = (payload: ImportEventPayloads[T]) => void

// Callback registration. on() returns the function that removes the handler.
// A handler that throws does not stop the import; its error is reported as a
// process warning.
export interface ImportEvents {
  on: <T extends ImportEventType>(type: T, handler: ImportEventHandler<T>) => () => void
}

export interface Importer extends ImportEvents {
  // Validates nothing about the files up front: each one settles as
  // processed-file or error. Events start on a later tick, so a handler
  // registered right after the call sees import:starting.
  import_files: (input: { file_paths: readonly string[], source?: ImportSource }) => ImportAck
}
