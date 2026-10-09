// The peer's replication: a replicator per open library on the network, the
// RECORD announcements, and the fetches around a merge (§5.4). A linked
// library whose AC chain is not local is loaded from peers in the background
// and opened once its chain resolves; a merged entry's content payload is
// fetched afterwards and re-indexed when it lands.

import { resolve_ac_chain } from '#access-control/resolve.ts'
import type { Network } from '#fabric/network.ts'
import { RECORD_TOPIC } from '#fabric/pubsub.ts'
import type { HashedEntry } from '#entry/signed.ts'
import { get_library_summary } from '#query-db/queries.ts'
import { create_replicator, type Replicator } from '#replication/replicator.ts'
import { SYSTEM_TIMERS, type Timers } from '#replication/timers.ts'
import { ProtocolError } from '#types/errors.ts'
import type { Library, PeerInfo } from '#types/peer.ts'
import { create_peer_announcements, type AnnouncedBy } from './announcements.ts'
import { create_content_fetcher } from './content-fetch.ts'
import { require_identity, serialise_write, type PeerContext } from './context.ts'
import { identity_state, linked_addresses } from './ownership.ts'

export interface PeerReplication {
  readonly network: Network
  // Joins RECORD and replicates every open library.
  start: () => Promise<void>
  // Replicates every open library not yet replicating, and loads every
  // linked one not yet open.
  sync: () => Promise<void>
  // Opens or loads the library, then starts or resumes its replication. Runs
  // inside serialise_write.
  connect: (library_address: string) => Promise<void>
  pause: (library_address: string) => void
  // Stops replication for good and drops its unresolved state (§5.4.4).
  unlink: (library_address: string) => Promise<void>
  heads_changed: (library_address: string) => void
  get: (library_address: string) => Replicator | undefined
  // Resolves once the library has nothing in flight, to merge, or to index.
  settled: (library_address: string) => Promise<void>
  announced_by: (peer_id: string) => AnnouncedBy | undefined
  list_peers: () => PeerInfo[]
  stop: () => Promise<void>
}

export const create_peer_replication = ({ context, network, describe_library, on_library_verified, timers = SYSTEM_TIMERS }: {
  context: PeerContext
  network: Network
  describe_library: (library_address: string) => Library | undefined
  on_library_verified?: ((library_address: string) => void) | undefined
  timers?: Timers
}): PeerReplication => {
  const { config, events, libraries, content_store, db } = context
  const replicators = new Map<string, Replicator>()
  const loading = new Set<string>()

  const get_block = async (cid: string): Promise<Uint8Array | undefined> =>
    await content_store.get(cid) ?? await network.fetch_block(cid, { signal: AbortSignal.timeout(config.traversal_timeout_ms) })
  const contents = create_content_fetcher({ context, get_block })

  const merge_into = (library_address: string) => async (entries: HashedEntry[]) => {
    const { merged } = await libraries.merge({ library_address, blocks: entries.map(({ bytes }) => bytes) })
    if (merged.length === 0) return
    const { length } = get_library_summary({ db, library_address })
    const heads = [...libraries.get(library_address)?.oplog.heads ?? []].sort()
    events.emit({ type: 'library:replicated', payload: { library_address, length, heads } })
    contents.fetch({ library_address, entries: merged })
  }

  const replicate = async (library_address: string) => {
    const handle = libraries.get(library_address)
    if (handle === undefined) return
    const existing = replicators.get(library_address)
    if (existing !== undefined) {
      existing.resume()
      contents.retry_missing(library_address)
      return
    }
    const replicator = create_replicator({
      oplog: handle.oplog,
      pubsub: network.pubsub,
      fetch_block: network.fetch_block,
      merge: merge_into(library_address),
      concurrency: config.traversal_concurrency,
      timeout_ms: config.traversal_timeout_ms,
      heads_interval_ms: config.heads_interval_ms,
      timers,
      on_status: (status) => { events.emit({ type: 'library:replicate-progress', payload: { library_address, ...status } }) },
      on_peer_join: (peer_id) => {
        events.emit({ type: 'library:peer-joined', payload: { library_address, peer_id } })
        contents.retry_missing(library_address)
        context.blobs.retry()
      },
      on_peer_leave: (peer_id) => { events.emit({ type: 'library:peer-left', payload: { library_address, peer_id } }) }
    })
    replicators.set(library_address, replicator)
    try {
      await replicator.start()
    } catch (error) {
      replicators.delete(library_address)
      throw error
    }
  }

  // The identity library, every library it records, and the link set.
  const is_wanted = (library_address: string) =>
    library_address === require_identity(context).identity_address ||
    identity_state(context).libraries.has(library_address) ||
    linked_addresses(context).includes(library_address)

  const connect = async (library_address: string) => {
    if (libraries.get(library_address) === undefined) {
      try {
        await libraries.open_library(library_address)
      } catch (error) {
        if (!(error instanceof ProtocolError)) throw error
        if (error.code === 'library_unopenable') load(library_address)
        return
      }
    }
    await replicate(library_address)
  }

  // Fetches the AC chain from peers, then opens and replicates the library,
  // unless it was unlinked meanwhile. A failure leaves it loading until the
  // next RECORD peer join retries it.
  const load = (library_address: string) => {
    if (loading.has(library_address) || context.stopping) return
    loading.add(library_address)
    resolve_ac_chain({ library_address, block_store: { get: get_block, put: async () => {} } })
      .then(async () => {
        await serialise_write(context, async () => { if (is_wanted(library_address)) await connect(library_address) })
        const library = describe_library(library_address)
        if (library !== undefined) events.emit({ type: 'library:loaded', payload: { library } })
      })
      .catch(() => {})
      .finally(() => { loading.delete(library_address) })
  }

  const sync = async () => {
    for (const { chain } of libraries.list()) {
      await replicate(chain.address).catch((error: unknown) => {
        process.emitWarning(`replication of ${chain.address} did not start: ${(error as Error).message}`)
      })
    }
    for (const address of linked_addresses(context)) {
      if (libraries.get(address) === undefined) load(address)
    }
  }

  const peer_count = () => network.pubsub.subscribers(RECORD_TOPIC).length
  const announcements = create_peer_announcements({
    context,
    network,
    timers,
    get_block,
    on_peer_join: (peer_id) => {
      events.emit({ type: 'peer:joined', payload: { peer_id, peer_count: peer_count() } })
      for (const address of linked_addresses(context)) {
        if (libraries.get(address) === undefined) load(address)
      }
    },
    on_peer_leave: (peer_id) => { events.emit({ type: 'peer:left', payload: { peer_id, peer_count: peer_count() } }) },
    on_library_verified
  })

  const settled = async (library_address: string) => {
    await replicators.get(library_address)?.idle()
    await contents.settled(library_address)
  }

  return {
    network,
    start: async () => {
      await announcements.start()
      await sync()
    },
    sync,
    connect,
    pause: (library_address) => { replicators.get(library_address)?.pause() },
    unlink: async (library_address) => {
      const replicator = replicators.get(library_address)
      replicators.delete(library_address)
      await replicator?.unlink()
      contents.forget(library_address)
      await settled(library_address)
    },
    heads_changed: (library_address) => { replicators.get(library_address)?.heads_changed() },
    get: (library_address) => replicators.get(library_address),
    settled,
    announced_by: announcements.announced_by,
    list_peers: () => network.list_peers().map(({ peer_id, multiaddrs, connected_at_ms }) => ({
      peer_id,
      multiaddrs,
      ...(connected_at_ms === undefined ? {} : { connected_at_ms }),
      library_addresses: [...(announcements.announced_by(peer_id)?.verified ?? [])]
    })),
    stop: async () => {
      await announcements.stop()
      for (const address of [...replicators.keys()]) {
        const replicator = replicators.get(address)
        replicators.delete(address)
        await replicator?.unlink()
        await settled(address)
      }
      await network.close()
    }
  }
}
