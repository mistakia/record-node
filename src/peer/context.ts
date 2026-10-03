// State shared by the peer's lifecycle and its ApiPeer methods.

import type { DatabaseSync } from 'node:sqlite'

import type { ContentStore } from '#fabric/content-store.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { Download } from '#ingest/download.ts'
import type { TrackTarget } from '#ingest/put-track.ts'
import type { Toolchain } from '#ingest/toolchain.ts'
import { list_linked_libraries } from '#query-db/queries.ts'
import type { IngestedTrack } from '#types/ingest.ts'
import type { PeerConfig } from './config.ts'
import type { EventBus } from './events.ts'
import type { LibraryManager } from './library.ts'
import type { ResolveUrl } from './resolver.ts'
import type { PeerStore } from './store.ts'

export interface PeerIdentity {
  readonly key_pair: KeyPair
  readonly own_address: string
  readonly listens_address: string
}

export interface PeerContext {
  readonly config: PeerConfig
  readonly store: PeerStore
  readonly content_store: ContentStore
  readonly db: DatabaseSync
  readonly libraries: LibraryManager
  readonly events: EventBus
  readonly resolve: ResolveUrl
  readonly download: Download
  // Set by start_peer, and replaced by an identity import.
  identity: PeerIdentity | undefined
  // The startup toolchain check: a failure refuses ingest, not the peer.
  toolchain: Promise<Toolchain> | undefined
  // Every write to a local library runs through here, one at a time, so a
  // read-then-append (dedup, relabel) never interleaves with another.
  writes: Promise<unknown>
}

export const require_identity = (context: PeerContext): PeerIdentity => {
  if (context.identity === undefined) throw new Error('the peer is not started')
  return context.identity
}

export const serialise_write = <T>(context: PeerContext, job: () => Promise<T>): Promise<T> => {
  const run = context.writes.then(job)
  context.writes = run.catch(() => {})
  return run
}

export const require_toolchain = async (context: PeerContext): Promise<Toolchain> => {
  if (context.toolchain === undefined) throw new Error('the peer is not started')
  return await context.toolchain
}

// The libraries the own library links to (§2.5).
export const linked_addresses = (context: PeerContext): string[] =>
  list_linked_libraries({ db: context.db, library_address: require_identity(context).own_address }).map(({ address }) => address)

// The own library and what it links: the default scope of every query.
export const visible_addresses = (context: PeerContext): string[] =>
  [require_identity(context).own_address, ...linked_addresses(context)]

// Runs one ingest pipeline against the own library and indexes a new entry.
export const ingest_into_own = (context: PeerContext, run: (target: TrackTarget) => Promise<IngestedTrack>): Promise<IngestedTrack> =>
  serialise_write(context, async () => {
    const { key_pair, own_address } = require_identity(context)
    const handle = context.libraries.get(own_address)
    if (handle === undefined) throw new Error('the own library is not open')
    const track = await run({ oplog: handle.oplog, key_pair, content_store: context.content_store })
    const entry = handle.oplog.entries.get(track.entry_hash)
    if (!track.existing && entry !== undefined) await context.libraries.register({ library_address: own_address, entries: [entry] })
    return track
  })
