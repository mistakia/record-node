// The peer: identity, content store, libraries, query index, ingest, and
// replication over the §5.5.1 network, wired together behind the ApiPeer
// surface.
import { readFileSync } from 'node:fs';
import { download_to_file } from '#ingest/download.ts';
import { ingest_local_file } from '#ingest/pipeline-local.ts';
import { verify_toolchain } from '#ingest/toolchain.ts';
import { generate_key_pair } from '#identity/key-pair.ts';
import { create_projector } from '#query-db/projector.ts';
import { list_linked_libraries } from '#query-db/queries.ts';
import { open_query_db } from '#query-db/schema.ts';
import { create_library_methods, describe_library, finish_pending_unlinks, try_open_library } from "./api-libraries.js";
import { create_track_methods } from "./api-tracks.js";
import { create_audio_source } from "./audio.js";
import { data_paths, resolve_peer_config } from "./config.js";
import { drain_queues, ingest_into_own, require_identity, require_toolchain, serialise_write } from "./context.js";
import { create_event_bus } from "./events.js";
import { identity_id_of, load_key_pair, marshal_private_key, marshal_public_key, peer_id_of, save_key_pair, unmarshal_private_key } from "./identity.js";
import { create_file_importer, import_url } from "./imports.js";
import { create_library_manager } from "./library.js";
import { LISTENS_LIBRARY_NAME } from "./listens.js";
import { project_entry_events } from "./notify.js";
import { create_peer_replication } from "./replication.js";
import { create_resolver, refuse_input_errors } from "./resolver.js";
import { create_file_state_store, create_memory_state_store } from "./state.js";
import { open_peer_store } from "./store.js";
export const OWN_LIBRARY_NAME = 'record';
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
// The own recordstore and listens libraries follow from the key, so the same
// key always reopens the same libraries (§3.6), and the links in the own
// library name the rest.
const open_identity = async (context, key_pair) => {
    const write_keys = [key_pair.public_key];
    const own = await context.libraries.create_library({ name: OWN_LIBRARY_NAME, type: 'recordstore', write_keys });
    const listens = await context.libraries.create_library({ name: LISTENS_LIBRARY_NAME, type: 'listens', write_keys });
    await context.libraries.settled();
    const identity = { key_pair, own_address: own.chain.address, listens_address: listens.chain.address };
    for (const { address } of list_linked_libraries({ db: context.db, library_address: identity.own_address })) {
        await try_open_library(context, address);
    }
    return identity;
};
export const create_peer = async ({ config: overrides = {}, resolve, download = download_to_file, network: join_network } = {}) => {
    const config = resolve_peer_config(overrides);
    const paths = config.data_dir === undefined ? undefined : data_paths(config.data_dir);
    const store = await open_peer_store({ data_dir: config.data_dir, network: join_network === undefined ? config.network : false });
    // A peer with a data dir keeps the query index on disk, so a restart opens
    // it instead of re-projecting every library from blocks; without one the
    // index stays in memory and dies with the process.
    const db = paths === undefined ? open_query_db() : open_query_db({ path: paths.index });
    const events = create_event_bus();
    const content_store = store.content_store;
    const network = join_network?.({ content_store }) ?? store.network;
    const libraries = create_library_manager({
        content_store,
        projector: create_projector({ db, read_content: content_store.get }),
        state_store: paths === undefined ? create_memory_state_store() : create_file_state_store({ path: paths.libraries }),
        on_entries: (input) => {
            project_entry_events({ context, ...input });
            context.replication?.heads_changed(input.library_address);
        }
    });
    const context = {
        config,
        store,
        content_store,
        db,
        libraries,
        events,
        resolve: refuse_input_errors(resolve ?? create_resolver({ ytdlp_path: config.ytdlp_path })),
        download,
        audio: create_audio_source({ content_store, network, timeout_ms: config.audio_fetch_timeout_ms, max_bytes: config.audio_cache_max_bytes }),
        replication: undefined,
        identity: undefined,
        toolchain: undefined,
        writes: Promise.resolve(),
        ingests: Promise.resolve(),
        stopping: false
    };
    if (network !== undefined) {
        context.replication = create_peer_replication({ context, network, describe_library: (address) => describe_library(context, address) });
    }
    const file_importer = create_file_importer(context);
    return {
        config,
        content_store,
        db,
        context,
        identity: () => require_identity(context),
        ingest_file: async (file_path) => await ingest_into_own(context, async (target) => await ingest_local_file({ file_path, target, toolchain: await require_toolchain(context) })),
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
            context.identity = await open_identity(context, key_pair);
            await context.replication?.sync();
            return { id: identity_id_of(key_pair), public_key: marshal_public_key(key_pair), own_library_address: context.identity.own_address };
        }),
        import_files: async (paths) => file_importer.import_files({ file_paths: paths }),
        import_url: async (url) => await import_url(context, url),
        subscribe: events.subscribe
    };
};
// Checks the toolchain, opens the own libraries and everything they link,
// finishes any unlink a crash cut short, and starts replicating. A toolchain
// refusal disables ingest and leaves the rest of the peer up.
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
    context.identity = await open_identity(context, key_pair);
    await serialise_write(context, async () => { await finish_pending_unlinks(context); });
    await context.replication?.start();
};
// Refuses new work, stops replicating once in-flight merges land, lets queued
// writes, ingests, and index updates finish, then closes the network, store,
// and index. A stopped peer does not start again.
export const stop_peer = async (peer) => {
    const { context } = peer;
    context.stopping = true;
    await context.replication?.stop();
    await drain_queues(context);
    await context.libraries.settled();
    await context.store.helia.stop();
    context.db.close();
    context.identity = undefined;
};
