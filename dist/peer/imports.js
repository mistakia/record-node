// Imports (§6.4.1, §6.4.2) with their import:* events. Ingest contract events
// become API events here: a processed file carries the indexed API Track, and
// a failure carries the spec's Error envelope.
import { rm } from 'node:fs/promises';
import { create_importer } from '#ingest/import.ts';
import { ingest_local_file } from '#ingest/pipeline-local.ts';
import { ingest_resolved_entry } from '#ingest/pipeline-url.ts';
import { find_existing_track } from '#ingest/put-track.ts';
import { find_track_by_source, get_track } from '#query-db/queries.ts';
import { ProtocolError } from '#types/errors.ts';
import { IngestError } from '#types/ingest.ts';
import { PeerError } from '#types/peer.ts';
import { ingest_into_own, require_identity, require_toolchain } from "./context.js";
import { to_api_track } from "./views.js";
const TOOL_ERROR_CODES = new Set(['toolchain_unavailable', 'toolchain_mismatch', 'tool_failed', 'download_failed']);
// An ingest or protocol refusal is the input's fault, and the rest the node's.
// Files settle one at a time and import:error follows its failure at once, so
// the last failure seen is the one being reported.
const classify_failures = () => {
    let code = 'INTERNAL_ERROR';
    return {
        ingest: async (run) => {
            try {
                return await run();
            }
            catch (error) {
                const input = (error instanceof IngestError && !TOOL_ERROR_CODES.has(error.code)) || error instanceof ProtocolError;
                code = input ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
                throw error;
            }
        },
        last_code: () => code
    };
};
// Relays one importer's events to the peer's subscribers.
const relay_events = ({ context, importer, failures }) => {
    const { emit } = context.events;
    const unsubscribers = [
        importer.on('import:starting', (payload) => { emit({ type: 'import:starting', payload }); }),
        importer.on('import:processed-file', ({ import_id, file_path, track, completed, remaining }) => {
            const row = get_track({ db: context.db, track_id: track.track_id, own_library_address: require_identity(context).own_address });
            const api_track = row === undefined ? undefined : to_api_track(row);
            if (api_track !== undefined)
                emit({ type: 'import:processed-file', payload: { import_id, file_path, track: api_track, completed, remaining } });
        }),
        importer.on('import:error', ({ import_id, file_path, error }) => {
            const code = failures.last_code();
            emit({ type: 'import:error', payload: { import_id, file_path, error: { error: { code, message: `${error.code}: ${error.message}` } } } });
        }),
        importer.on('import:finished', (payload) => { emit({ type: 'import:finished', payload }); })
    ];
    return () => { for (const unsubscribe of unsubscribers)
        unsubscribe(); };
};
// Uploaded files belong to ingest once accepted, and are removed when done.
export const create_file_importer = (context) => {
    const failures = classify_failures();
    const importer = create_importer({
        ingest_file: async (file_path) => await failures.ingest(async () => {
            try {
                return await ingest_into_own(context, async (target) => await ingest_local_file({ file_path, target, toolchain: await require_toolchain(context) }));
            }
            finally {
                await rm(file_path, { force: true });
            }
        })
    });
    relay_events({ context, importer, failures });
    return importer;
};
const find_by_source = (context) => ({ extractor, id }) => {
    const { own_address } = require_identity(context);
    const track_id = find_track_by_source({ db: context.db, library_address: own_address, extractor, id });
    const oplog = context.libraries.get(own_address)?.oplog;
    return track_id === undefined || oplog === undefined ? undefined : find_existing_track({ oplog, track_id });
};
// Resolves first, so a URL the resolver refuses is the request's error; then
// each resolved source settles as one file of the import, reported under the
// URL it came from.
export const import_url = async (context, url) => {
    const entries = await context.resolve(url);
    if (entries.length === 0)
        throw new PeerError('invalid', `no source found at ${url}`);
    const failures = classify_failures();
    const importer = create_importer({
        ingest_file: async (_url, index) => await failures.ingest(async () => {
            return await ingest_into_own(context, async (target) => await ingest_resolved_entry({
                entry: entries[index],
                target,
                toolchain: await require_toolchain(context),
                find_by_source: find_by_source(context),
                download: context.download
            }));
        })
    });
    const unsubscribe = relay_events({ context, importer, failures });
    importer.on('import:finished', () => { unsubscribe(); });
    const { import_id } = importer.import_files({ file_paths: entries.map(() => url), source: 'url' });
    return { import_id };
};
