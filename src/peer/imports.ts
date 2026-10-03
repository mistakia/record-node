// Imports (§6.4.1, §6.4.2) with their import:* events. Ingest contract events
// become API events here: a processed file carries the indexed API Track, and
// a failure carries the spec's Error envelope.

import { rm } from 'node:fs/promises'

import { create_importer } from '#ingest/import.ts'
import { commit_local_file, prepare_local_file, prepared_blobs, type PreparedTrack, type ReleaseBlobs } from '#ingest/pipeline-local.ts'
import { commit_resolved_entry, prepare_resolved_entry, source_blobs } from '#ingest/pipeline-url.ts'
import { find_existing_track, type TrackTarget } from '#ingest/put-track.ts'
import { find_track_by_source, get_track } from '#query-db/queries.ts'
import { ProtocolError } from '#types/errors.ts'
import { IngestError, type Importer, type IngestedTrack } from '#types/ingest.ts'
import { PeerError, type ImportAck, type WriteTargetInput } from '#types/peer.ts'
import { ingest_into, require_toolchain, type PeerContext } from './context.ts'
import { identity_state, own_recordstore_addresses } from './ownership.ts'
import { to_api_track } from './views.ts'
import { as_write_refusal, resolve_write_target, type WriteTarget } from './write-target.ts'

const TOOL_ERROR_CODES = new Set(['toolchain_unavailable', 'toolchain_mismatch', 'tool_failed', 'download_failed'])

// The chapter 7 error code an import:error carries for a failure.
const import_error_code = (error: unknown): string => {
  if (error instanceof IngestError) {
    if (error.code === 'degenerate_fingerprint') return 'DEGENERATE_FINGERPRINT'
    if (error.code === 'track_id_collision') return 'TRACK_ID_COLLISION'
    return TOOL_ERROR_CODES.has(error.code) ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'
  }
  if (error instanceof PeerError) {
    if (error.code === 'forbidden') return 'FORBIDDEN'
    if (error.code === 'capability_expired') return 'CAPABILITY_EXPIRED'
    if (error.code === 'capability_revoked') return 'CAPABILITY_REVOKED'
    if (error.code === 'conflict') return 'CONFLICT'
    return 'VALIDATION_ERROR'
  }
  return error instanceof ProtocolError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'
}

// Files settle one at a time and import:error follows its failure at once, so
// the last failure seen is the one being reported.
const classify_failures = () => {
  let code = 'INTERNAL_ERROR'
  return {
    ingest: async (run: () => Promise<IngestedTrack>): Promise<IngestedTrack> => {
      try {
        return await run()
      } catch (error) {
        const refusal = as_write_refusal(error)
        code = import_error_code(refusal)
        throw refusal
      }
    },
    last_code: () => code
  }
}

type Failures = ReturnType<typeof classify_failures>

// Relays one importer's events to the peer's subscribers.
const relay_events = ({ context, importer, failures, target }: {
  context: PeerContext
  importer: Importer
  failures: Failures
  target: WriteTarget
}): () => void => {
  const { emit } = context.events
  const unsubscribers = [
    importer.on('import:starting', (payload) => { emit({ type: 'import:starting', payload }) }),
    importer.on('import:processed-file', ({ import_id, file_path, track, completed, remaining }) => {
      const row = get_track({
        db: context.db, track_id: track.track_id, own_library_addresses: own_recordstore_addresses(context), library_addresses: [target.address]
      })
      const api_track = row === undefined ? undefined : to_api_track(row, identity_state(context).pins)
      if (api_track !== undefined) emit({ type: 'import:processed-file', payload: { import_id, file_path, track: api_track, completed, remaining } })
    }),
    importer.on('import:error', ({ import_id, file_path, error }) => {
      const code = failures.last_code()
      emit({ type: 'import:error', payload: { import_id, file_path, error: { error: { code, message: `${error.code}: ${error.message}` } } } })
    }),
    importer.on('import:finished', (payload) => { emit({ type: 'import:finished', payload }) })
  ]
  return () => { for (const unsubscribe of unsubscribers) unsubscribe() }
}

// The two phases of a local file ingest (§6.4.1), for ingest_into.
export const local_file_phases = (context: PeerContext, file_path: string) => ({
  prepare: async (target: TrackTarget) => await prepare_local_file({ file_path, target, toolchain: await require_toolchain(context) }),
  commit: async ({ target, prepared, release }: { target: TrackTarget, prepared: PreparedTrack, release: ReleaseBlobs }) =>
    await commit_local_file({ prepared, target, release }),
  blobs: prepared_blobs
})

// Uploaded files belong to ingest once accepted, and are removed when done.
// The target is resolved before the import is accepted, so a write the
// identity cannot make is the request's error, not the files'.
export const import_files = (context: PeerContext, { paths, library_address, capability_id }: { paths: string[] } & WriteTargetInput): ImportAck => {
  const target = resolve_write_target(context, { library_address, capability_id })
  const failures = classify_failures()
  const importer = create_importer({
    ingest_file: async (file_path) => await failures.ingest(async () => {
      try {
        return await ingest_into(context, target, local_file_phases(context, file_path))
      } finally {
        await rm(file_path, { force: true })
      }
    })
  })
  const unsubscribe = relay_events({ context, importer, failures, target })
  importer.on('import:finished', () => { unsubscribe() })
  return importer.import_files({ file_paths: paths })
}

const find_by_source = (target: WriteTarget, context: PeerContext) => ({ extractor, id }: { extractor: string, id: string }): IngestedTrack | undefined => {
  const track_id = find_track_by_source({ db: context.db, library_address: target.address, extractor, id })
  return track_id === undefined ? undefined : find_existing_track({ oplog: target.handle.oplog, track_id })
}

// Resolves first, so a URL the resolver refuses is the request's error; then
// each resolved source settles as one file of the import, reported under the
// URL it came from.
export const import_url = async (context: PeerContext, { url, library_address, capability_id }: { url: string } & WriteTargetInput): Promise<ImportAck> => {
  const target = resolve_write_target(context, { library_address, capability_id })
  const entries = await context.resolve(url)
  if (entries.length === 0) throw new PeerError('invalid', `no source found at ${url}`)
  const failures = classify_failures()
  const importer = create_importer({
    ingest_file: async (_url, index) => await failures.ingest(async () => {
      return await ingest_into(context, target, {
        prepare: async (track_target) => await prepare_resolved_entry({
          entry: entries[index] as (typeof entries)[number],
          target: track_target,
          toolchain: await require_toolchain(context),
          find_by_source: find_by_source(target, context),
          download: context.download
        }),
        commit: async ({ target: track_target, prepared, release }) => await commit_resolved_entry({ source: prepared, target: track_target, release }),
        blobs: source_blobs
      })
    })
  })
  const unsubscribe = relay_events({ context, importer, failures, target })
  importer.on('import:finished', () => { unsubscribe() })
  const { import_id } = importer.import_files({ file_paths: entries.map(() => url), source: 'url' })
  return { import_id }
}
