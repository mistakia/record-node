// State shared by the peer's lifecycle and its ApiPeer methods.

import type { DatabaseSync } from 'node:sqlite'

import type { CommitBatcher } from '#fabric/commit-batch.ts'
import type { ContentStore } from '#fabric/content-store.ts'
import type { KeyPair } from '#identity/key-pair.ts'
import type { Download } from '#ingest/download.ts'
import type { TrackTarget } from '#ingest/put-track.ts'
import type { Toolchain } from '#ingest/toolchain.ts'
import type { IngestedTrack } from '#types/ingest.ts'
import type { AudioSource } from './audio.ts'
import type { BlobKeeper } from './blobs.ts'
import type { PeerConfig } from './config.ts'
import type { EventBus } from './events.ts'
import type { ImageSource } from './images.ts'
import type { DataDirectoryLock } from './lock.ts'
import type { LibraryManager } from './library.ts'
import type { Census } from './census.ts'
import type { PeerReplication } from './replication.ts'
import type { ResolveUrl } from './resolver.ts'
import { assert_writable, type WriteTarget } from './write-target.ts'
import type { StoredPolicy } from './state.ts'
import type { PeerStore } from './store.ts'

// The key, and the identity library its own libraries, links, and pins are
// read from (§4.8). Everything else about the identity is derived.
export interface PeerIdentity {
  readonly key_pair: KeyPair
  readonly identity_address: string
}

export interface PeerContext {
  readonly config: PeerConfig
  readonly store: PeerStore
  readonly content_store: ContentStore
  readonly db: DatabaseSync
  // Defers the query-index commits to a batch; none on an in-memory peer.
  readonly index_commit: CommitBatcher | undefined
  readonly libraries: LibraryManager
  readonly events: EventBus
  readonly resolve: ResolveUrl
  readonly download: Download
  readonly audio: AudioSource
  readonly images: ImageSource
  // Set when the peer has a network; a networkless peer only opens libraries.
  replication: PeerReplication | undefined
  // Set when config.census is on.
  census: Census | undefined
  // Set by start_peer, and replaced by an identity import.
  identity: PeerIdentity | undefined
  // The startup toolchain check: a failure refuses ingest, not the peer.
  toolchain: Promise<Toolchain> | undefined
  // The data-directory lock (§8.4.6), held until stop; none without a data dir.
  readonly lock: DataDirectoryLock | undefined
  // Library lifecycle and metadata writes run through here, one at a time,
  // so a read-then-append or an open never interleaves with an unlink.
  writes: Promise<unknown>
  // Ingest commits queue separately, one at a time, so their step-3 dedup
  // check stays atomic, while the long download and tool runs before them
  // (prepares) run beside each other and never block a tag, listen, or link.
  // An append itself is synchronous, so the two queues never interleave
  // inside one.
  ingests: Promise<unknown>
  // Set by stop_peer: new work is refused, queued work still runs.
  stopping: boolean
  // What the last identity-library sync applied: the link set and the own
  // libraries with whether each was retired. ready once the first sync ran.
  known: { ready: boolean, links: Set<string>, libraries: Map<string, boolean> }
  // Ingest prepares running now, and those waiting for a slot.
  readonly prepares: { active: number, waiting: Array<() => void>, in_flight: Set<Promise<void>> }
  // Node-local replication policies, as stored (§4.6.1).
  readonly policies: Map<string, StoredPolicy>
  // Item 6 and pinned blobs (§4.6.1, §4.6.2, §5.4.6). Set by create_peer.
  blobs: BlobKeeper
}

export const require_identity = (context: PeerContext): PeerIdentity => {
  if (context.identity === undefined) throw new Error('the peer is not started')
  return context.identity
}

const enqueue = <T>(tail: Promise<unknown>, job: () => Promise<T>): { run: Promise<T>, tail: Promise<unknown> } => {
  const run = tail.then(job)
  return { run, tail: run.catch(() => {}) }
}

export const refuse_when_stopping = (context: PeerContext): void => {
  if (context.stopping) throw new Error('the peer is stopping')
}

export const serialise_write = async <T>(context: PeerContext, job: () => Promise<T>): Promise<T> => {
  refuse_when_stopping(context)
  const { run, tail } = enqueue(context.writes, job)
  context.writes = tail
  return run
}

// Waits until both queues are empty, including work queued while waiting.
// Waits until both queues are empty and no prepare is in flight, including
// work queued while waiting: a prepare that finishes still commits.
export const drain_queues = async (context: PeerContext): Promise<void> => {
  for (;;) {
    const { writes, ingests } = context
    const preparing = [...context.prepares.in_flight]
    await Promise.allSettled([writes, ingests, ...preparing])
    if (writes === context.writes && ingests === context.ingests && context.prepares.in_flight.size === 0) return
  }
}

export const require_toolchain = async (context: PeerContext): Promise<Toolchain> => {
  if (context.toolchain === undefined) throw new Error('the peer is not started')
  return await context.toolchain
}

// At most config.ingest_prepare_concurrency prepares run at once; the rest
// wait their turn in arrival order.
const run_prepare = async <P>(context: PeerContext, job: () => Promise<P>): Promise<P> => {
  const gate = context.prepares
  if (gate.active >= context.config.ingest_prepare_concurrency) {
    await new Promise<void>((resolve) => { gate.waiting.push(resolve) })
  } else {
    gate.active += 1
  }
  const run = job()
  const tracked = run.then(() => {}, () => {})
  gate.in_flight.add(tracked)
  try {
    return await run
  } finally {
    gate.in_flight.delete(tracked)
    const next = gate.waiting.shift()
    if (next === undefined) gate.active -= 1
    else next()
  }
}

// One ingest against a write target, in two phases. prepare does the
// per-file work (decode, strip, blob import) and runs beside other prepares;
// commit makes the step 3 decision and appends, one at a time, so its dedup
// check stays atomic. A prepare accepted before stop still commits. The
// target is checked again at commit, since a library retired meanwhile
// refuses new writes (§4.8.3), and a new entry is indexed.
export const ingest_into = async <P>(context: PeerContext, target: WriteTarget, { prepare, commit, blobs }: {
  prepare: (target: TrackTarget) => Promise<P>
  commit: (input: { target: TrackTarget, prepared: P, release: (cids: readonly string[]) => Promise<void> }) => Promise<IngestedTrack>
  // What a prepare pinned, released when its commit is refused before it runs.
  blobs: (prepared: P) => readonly string[]
}): Promise<IngestedTrack> => {
  refuse_when_stopping(context)
  const { key_pair } = require_identity(context)
  const track_target: TrackTarget = { oplog: target.handle.oplog, key_pair, content_store: context.content_store, capability_id: target.capability_id }
  const prepared = await run_prepare(context, async () => await prepare(track_target))
  const release = async (cids: readonly string[]) => { await context.libraries.release_unheld(cids) }
  const { run, tail } = enqueue(context.ingests, async () => {
    try {
      assert_writable(context, target)
    } catch (error) {
      await release(blobs(prepared))
      throw error
    }
    const track = await commit({ target: track_target, prepared, release })
    const entry = target.handle.oplog.entries.get(track.entry_hash)
    if (!track.existing && entry !== undefined) await context.libraries.register({ library_address: target.address, entries: [entry] })
    return track
  })
  context.ingests = tail
  return await run
}
