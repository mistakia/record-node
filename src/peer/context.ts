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
import type { PeerReplication } from './replication.ts'
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
  // Set when the peer has a network; a networkless peer only opens libraries.
  replication: PeerReplication | undefined
  // Set by start_peer, and replaced by an identity import.
  identity: PeerIdentity | undefined
  // The startup toolchain check: a failure refuses ingest, not the peer.
  toolchain: Promise<Toolchain> | undefined
  // Library lifecycle and metadata writes run through here, one at a time,
  // so a read-then-append or an open never interleaves with an unlink.
  writes: Promise<unknown>
  // Ingests queue separately, one at a time, so their step-3 dedup check
  // stays atomic while a long download or tool run never blocks a tag,
  // listen, or link. An append itself is synchronous, so the two queues never
  // interleave inside one.
  ingests: Promise<unknown>
  // Set by stop_peer: new work is refused, queued work still runs.
  stopping: boolean
}

export const require_identity = (context: PeerContext): PeerIdentity => {
  if (context.identity === undefined) throw new Error('the peer is not started')
  return context.identity
}

const enqueue = <T>(tail: Promise<unknown>, job: () => Promise<T>): { run: Promise<T>, tail: Promise<unknown> } => {
  const run = tail.then(job)
  return { run, tail: run.catch(() => {}) }
}

const refuse_when_stopping = (context: PeerContext): void => {
  if (context.stopping) throw new Error('the peer is stopping')
}

export const serialise_write = async <T>(context: PeerContext, job: () => Promise<T>): Promise<T> => {
  refuse_when_stopping(context)
  const { run, tail } = enqueue(context.writes, job)
  context.writes = tail
  return run
}

const serialise_ingest = async <T>(context: PeerContext, job: () => Promise<T>): Promise<T> => {
  refuse_when_stopping(context)
  const { run, tail } = enqueue(context.ingests, job)
  context.ingests = tail
  return run
}

// Waits until both queues are empty, including work queued while waiting.
export const drain_queues = async (context: PeerContext): Promise<void> => {
  for (;;) {
    const { writes, ingests } = context
    await Promise.all([writes, ingests])
    if (writes === context.writes && ingests === context.ingests) return
  }
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
  serialise_ingest(context, async () => {
    const { key_pair, own_address } = require_identity(context)
    const handle = context.libraries.get(own_address)
    if (handle === undefined) throw new Error('the own library is not open')
    const track = await run({ oplog: handle.oplog, key_pair, content_store: context.content_store })
    const entry = handle.oplog.entries.get(track.entry_hash)
    if (!track.existing && entry !== undefined) await context.libraries.register({ library_address: own_address, entries: [entry] })
    return track
  })
