// The peer: identity, content store, libraries, query index, ingest, and
// replication over the §5.5.1 network, wired together behind the ApiPeer
// surface.
import { readFileSync } from 'node:fs';
import { download_to_file } from '#ingest/download.ts';
import { verify_toolchain } from '#ingest/toolchain.ts';
import { generate_key_pair } from '#identity/key-pair.ts';
import { create_entry_block_cache } from '#query-db/entry-blocks.ts';
import { create_projector } from '#query-db/projector.ts';
import { create_commit_batcher, DEFAULT_COMMIT_POLICY } from '#fabric/commit-batch.ts';
import { open_query_db } from '#query-db/schema.ts';
import { SYSTEM_TIMERS } from '#replication/timers.ts';
import { create_library_methods } from "./api-libraries.js";
import { create_track_methods } from "./api-tracks.js";
import { create_audio_source } from "./audio.js";
import { create_blob_keeper } from "./blobs.js";
import { data_paths, resolve_peer_config } from "./config.js";
import { drain_queues, ingest_into, refuse_when_stopping, require_identity, serialise_write } from "./context.js";
import { describe_library } from "./describe.js";
import { create_event_bus } from "./events.js";
import { identity_id_of, load_key_pair, marshal_private_key, marshal_public_key, peer_id_of, save_key_pair, unmarshal_private_key } from "./identity.js";
import { finish_pending_unlinks, meta_log_record, open_identity, queue_identity_sync } from "./identity-library.js";
import { import_files, import_url, local_file_phases } from "./imports.js";
import { create_library_manager } from "./library.js";
import { project_entry_events } from "./notify.js";
import { default_own_library, listens_library, OWN_LIBRARY_NAME } from "./ownership.js";
import { keeps_blobs } from "./policy.js";
import { create_peer_replication } from "./replication.js";
import { create_resolver, refuse_input_errors } from "./resolver.js";
import { create_file_state_store, create_memory_state_store } from "./state.js";
import { lock_data_dir } from "./lock.js";
import { open_peer_store } from "./store.js";
import { resolve_write_target } from "./write-target.js";
export { OWN_LIBRARY_NAME };
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export const create_peer = async ({ config: overrides = {}, resolve, download = download_to_file, network: join_network } = {}) => {
    const config = resolve_peer_config(overrides);
    const paths = config.data_dir === undefined ? undefined : data_paths(config.data_dir);
    // Before anything in the directory opens (§8.4.6); a held lock leaves it untouched.
    const lock = config.data_dir === undefined ? undefined : lock_data_dir(config.data_dir);
    let store;
    try {
        store = await open_peer_store({ data_dir: config.data_dir, network: join_network === undefined ? config.network : false });
    }
    catch (error) {
        lock?.release();
        throw error;
    }
    // A peer with a data dir keeps the query index on disk, so a restart opens
    // it instead of re-projecting every library from blocks; without one the
    // index stays in memory and dies with the process.
    const db = paths === undefined ? open_query_db() : open_query_db({ path: paths.index });
    // Commit batching so a disk-backed peer's per-filed index writes coalesce;
    // the index is derived (§4.7), so a lost last batch is rebuilt at open.
    const index_commit = paths === undefined ? undefined : create_commit_batcher(db, DEFAULT_COMMIT_POLICY);
    const events = create_event_bus();
    const content_store = store.content_store;
    const network = join_network?.({ content_store }) ?? store.network;
    const libraries = create_library_manager({
        content_store,
        projector: create_projector({ db, read_content: content_store.get, commit: index_commit }),
        entry_blocks: create_entry_block_cache({ db, commit: index_commit }),
        state_store: paths === undefined ? create_memory_state_store() : create_file_state_store({ path: paths.libraries }),
        keeps_blobs: (chain) => keeps_blobs(context)(chain),
        retained: () => context.blobs.retained(),
        on_entries: (input) => {
            project_entry_events({ context, ...input });
            context.replication?.heads_changed(input.library_address);
            if (input.library_address === context.identity?.identity_address) {
                for (const entry of input.entries) {
                    context.events.emit({ type: 'identity:meta-log-appended', payload: { record: meta_log_record(context, entry) } });
                }
                queue_identity_sync(context);
            }
            else if (context.identity !== undefined) {
                context.blobs.entries(input.library_address, input.entries)
                    .catch((error) => { process.emitWarning(`content fetch for ${input.library_address} failed: ${error.message}`); });
            }
        }
    });
    const context = {
        config,
        store,
        content_store,
        db,
        index_commit,
        libraries,
        events,
        resolve: refuse_input_errors(resolve ?? create_resolver({ ytdlp_path: config.ytdlp_path })),
        download,
        audio: create_audio_source({ content_store, network, timeout_ms: config.audio_fetch_timeout_ms, max_bytes: config.audio_cache_max_bytes }),
        replication: undefined,
        identity: undefined,
        toolchain: undefined,
        lock,
        writes: Promise.resolve(),
        ingests: Promise.resolve(),
        stopping: false,
        known: { ready: false, links: new Set(), libraries: new Map() },
        prepares: { active: 0, waiting: [], in_flight: new Set() },
        policies: new Map(await libraries.load_policies()),
        blobs: undefined
    };
    context.blobs = create_blob_keeper({ context, network, timers: SYSTEM_TIMERS, timeout_ms: config.blob_fetch_timeout_ms });
    if (network !== undefined) {
        context.replication = create_peer_replication({ context, network, describe_library: (address) => describe_library(context, address) });
    }
    return {
        config,
        content_store,
        db,
        context,
        identity: () => {
            const { key_pair, identity_address } = require_identity(context);
            return { key_pair, identity_address, own_address: default_own_library(context) ?? '', listens_address: listens_library(context) ?? '' };
        },
        ingest_file: async (file_path) => {
            refuse_when_stopping(context);
            return await ingest_into(context, resolve_write_target(context, {}), local_file_phases(context, file_path));
        },
        ...create_track_methods(context),
        ...create_library_methods(context),
        list_peers: async () => context.replication?.list_peers() ?? [],
        // The libp2p peer id when networked; a networkless peer reports the one
        // its identity key would have.
        get_settings: async () => ({
            peer_id: network?.peer_id ?? peer_id_of(require_identity(context).key_pair),
            addresses: network?.addresses() ?? [],
            version: VERSION
        }),
        export_identity: async () => {
            const { key_pair } = require_identity(context);
            return { public_key: marshal_public_key(key_pair), private_key: marshal_private_key(key_pair) };
        },
        // The previous identity's libraries stay on disk, orphaned until its key
        // is imported again.
        import_identity: async ({ private_key }) => await serialise_write(context, async () => {
            const key_pair = private_key === undefined ? generate_key_pair() : unmarshal_private_key(private_key);
            if (paths !== undefined)
                await save_key_pair({ path: paths.identity, key_pair });
            await open_identity(context, key_pair);
            await context.replication?.sync();
            return {
                id: identity_id_of(key_pair),
                public_key: marshal_public_key(key_pair),
                own_library_address: default_own_library(context) ?? '',
                meta_log_address: require_identity(context).identity_address
            };
        }),
        import_files: async (input) => import_files(context, input),
        import_url: async (input) => await import_url(context, input),
        subscribe: events.subscribe
    };
};
// Checks the toolchain, opens the identity library and every library it
// records or links, finishes any unlink a crash cut short, and starts
// replicating. A toolchain refusal disables ingest and leaves the rest of the
// peer up.
export const start_peer = async (peer) => {
    const { context } = peer;
    if (context.stopping)
        throw new Error('a stopped peer does not start again; create a new one');
    if (context.identity !== undefined)
        return;
    const { ffmpeg_path, fpcalc_path, allow_toolchain_mismatch, data_dir } = context.config;
    context.toolchain = verify_toolchain({ ffmpeg_path, fpcalc_path, allow_version_mismatch: allow_toolchain_mismatch });
    context.toolchain.catch(() => { });
    const key_pair = await load_key_pair({ path: data_dir === undefined ? undefined : data_paths(data_dir).identity });
    await open_identity(context, key_pair);
    await serialise_write(context, async () => { await finish_pending_unlinks(context); });
    await context.replication?.start();
};
// Refuses new work, stops replicating once in-flight merges land, lets queued
// writes, ingests, and index updates finish, then closes the network, store,
// index, and data-directory lock. A stopped peer does not start again, and
// stopping it again waits on the first stop.
const stops = new WeakMap();
export const stop_peer = async (peer) => {
    const { context } = peer;
    const running = stops.get(context) ?? stop_context(context);
    stops.set(context, running);
    await running;
};
const stop_context = async (context) => {
    context.stopping = true;
    context.libraries.stop_pin_passes();
    context.blobs.stop();
    await context.replication?.stop();
    await drain_queues(context);
    await context.blobs.settled();
    await context.libraries.settled();
    await context.libraries.pins_settled();
    await context.store.stop();
    context.index_commit?.close();
    context.db.close();
    context.lock?.release();
    context.identity = undefined;
};
