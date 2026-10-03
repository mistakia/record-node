// The peer: identity, content store, libraries, query index, and ingest
// wired together behind the ApiPeer surface. The replication stage adds the
// §5.5.1 network to start_peer and stop_peer.

import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

import type { ContentStore } from '#fabric/content-store.ts'
import { download_to_file, type Download } from '#ingest/download.ts'
import { ingest_local_file } from '#ingest/pipeline-local.ts'
import { verify_toolchain } from '#ingest/toolchain.ts'
import { generate_key_pair, type KeyPair } from '#identity/key-pair.ts'
import { create_projector } from '#query-db/projector.ts'
import { list_linked_libraries } from '#query-db/queries.ts'
import { open_query_db } from '#query-db/schema.ts'
import type { IngestedTrack } from '#types/ingest.ts'
import type { ApiPeer } from '#types/peer.ts'
import { create_library_methods, finish_pending_unlinks, try_open_library } from './api-libraries.ts'
import { create_track_methods } from './api-tracks.ts'
import { data_paths, resolve_peer_config, type PeerConfig } from './config.ts'
import { drain_queues, ingest_into_own, require_identity, require_toolchain, serialise_write, type PeerContext, type PeerIdentity } from './context.ts'
import { create_event_bus } from './events.ts'
import { identity_id_of, load_key_pair, marshal_private_key, marshal_public_key, peer_id_of, save_key_pair, unmarshal_private_key } from './identity.ts'
import { create_file_importer, import_url } from './imports.ts'
import { create_library_manager } from './library.ts'
import { LISTENS_LIBRARY_NAME } from './listens.ts'
import { project_entry_events } from './notify.ts'
import { create_resolver, refuse_input_errors, type ResolveUrl } from './resolver.ts'
import { create_file_state_store, create_memory_state_store } from './state.ts'
import { open_peer_store } from './store.ts'

export const OWN_LIBRARY_NAME = 'record'

const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version

export interface Peer extends ApiPeer {
  readonly config: PeerConfig
  readonly content_store: ContentStore
  readonly db: DatabaseSync
  readonly identity: () => PeerIdentity
  // Ingests one local file into the own library (§6.4.1) and leaves the
  // file in place, unlike import_files.
  readonly ingest_file: (file_path: string) => Promise<IngestedTrack>
  readonly context: PeerContext
}

export interface CreatePeerOptions {
  config?: Partial<PeerConfig>
  // URL resolution and download for §6.4.2; record-resolver and fetch by default.
  resolve?: ResolveUrl
  download?: Download
}

// The own recordstore and listens libraries follow from the key, so the same
// key always reopens the same libraries (§3.6), and the links in the own
// library name the rest.
const open_identity = async (context: PeerContext, key_pair: KeyPair): Promise<PeerIdentity> => {
  const write_keys = [key_pair.public_key]
  const own = await context.libraries.create_library({ name: OWN_LIBRARY_NAME, type: 'recordstore', write_keys })
  const listens = await context.libraries.create_library({ name: LISTENS_LIBRARY_NAME, type: 'listens', write_keys })
  await context.libraries.settled()
  const identity = { key_pair, own_address: own.chain.address, listens_address: listens.chain.address }
  for (const { address } of list_linked_libraries({ db: context.db, library_address: identity.own_address })) {
    await try_open_library(context, address)
  }
  return identity
}

export const create_peer = async ({ config: overrides = {}, resolve, download = download_to_file }: CreatePeerOptions = {}): Promise<Peer> => {
  const config = resolve_peer_config(overrides)
  const paths = config.data_dir === undefined ? undefined : data_paths(config.data_dir)
  const store = await open_peer_store({ data_dir: config.data_dir })
  const db = open_query_db()
  const events = create_event_bus()
  const content_store = store.content_store
  const libraries = create_library_manager({
    content_store,
    projector: create_projector({ db, read_content: content_store.get }),
    state_store: paths === undefined ? create_memory_state_store() : create_file_state_store({ path: paths.libraries }),
    on_entries: (input) => { project_entry_events({ context, ...input }) }
  })
  const context: PeerContext = {
    config,
    store,
    content_store,
    db,
    libraries,
    events,
    resolve: refuse_input_errors(resolve ?? create_resolver({ ytdlp_path: config.ytdlp_path })),
    download,
    identity: undefined,
    toolchain: undefined,
    writes: Promise.resolve(),
    ingests: Promise.resolve(),
    stopping: false
  }
  const file_importer = create_file_importer(context)

  return {
    config,
    content_store,
    db,
    context,
    identity: () => require_identity(context),
    ingest_file: async (file_path) => await ingest_into_own(context, async (target) =>
      await ingest_local_file({ file_path, target, toolchain: await require_toolchain(context) })),
    ...create_track_methods(context),
    ...create_library_methods(context),

    list_peers: async () => [],
    get_settings: async () => ({ peer_id: peer_id_of(require_identity(context).key_pair), addresses: [], version: VERSION }),
    export_identity: async () => {
      const { key_pair } = require_identity(context)
      return { public_key: marshal_public_key(key_pair), private_key: marshal_private_key(key_pair) }
    },
    // The previous identity's libraries stay on disk, orphaned until its key
    // is imported again.
    import_identity: async ({ private_key }) => await serialise_write(context, async () => {
      const key_pair = private_key === undefined ? generate_key_pair() : unmarshal_private_key(private_key)
      if (paths !== undefined) await save_key_pair({ path: paths.identity, key_pair })
      context.identity = await open_identity(context, key_pair)
      return { id: identity_id_of(key_pair), public_key: marshal_public_key(key_pair), own_library_address: context.identity.own_address }
    }),

    import_files: async (paths) => file_importer.import_files({ file_paths: paths }),
    import_url: async (url) => await import_url(context, url),
    subscribe: events.subscribe
  }
}

// Checks the toolchain, opens the own libraries and everything they link, and
// finishes any unlink a crash cut short. A toolchain refusal disables ingest
// and leaves the rest of the peer up.
export const start_peer = async (peer: Peer): Promise<void> => {
  const { context } = peer
  if (context.stopping) throw new Error('a stopped peer does not start again; create a new one')
  if (context.identity !== undefined) return
  const { ffmpeg_path, fpcalc_path, allow_toolchain_mismatch, data_dir } = context.config
  context.toolchain = verify_toolchain({ ffmpeg_path, fpcalc_path, allow_version_mismatch: allow_toolchain_mismatch })
  context.toolchain.catch(() => {})
  const key_pair = await load_key_pair({ path: data_dir === undefined ? undefined : data_paths(data_dir).identity })
  context.identity = await open_identity(context, key_pair)
  await serialise_write(context, async () => { await finish_pending_unlinks(context) })
}

// Refuses new work, lets queued writes, ingests, and index updates finish,
// then closes the store and index. A stopped peer does not start again.
export const stop_peer = async (peer: Peer): Promise<void> => {
  const { context } = peer
  context.stopping = true
  await drain_queues(context)
  await context.libraries.settled()
  for (const { chain } of context.libraries.list()) await context.libraries.close_library(chain.address)
  await context.store.helia.stop()
  context.db.close()
  context.identity = undefined
}
