// The peer's RECORD topic (§5.3): announcing its own About and its non-empty
// linked libraries' Abouts, and indexing what other peers announce. An
// announced library counts for a peer only once authenticate_announced has
// verified it; until then it is a hint and changes nothing local.

import { compute_about_id } from '#entry/id.ts'
import { is_put } from '#entry/operations.ts'
import { decode_payload } from '#entry/payload.ts'
import type { Network } from '#fabric/network.ts'
import { RECORD_TOPIC, type PubSubMessage } from '#fabric/pubsub.ts'
import { get_live_entry } from '#oplog/dag.ts'
import { authenticate_announced, create_announcer } from '#replication/announcement.ts'
import { build_loaded_about_entry, decode_announcement, encode_announcement, type AnnouncedLibrary, type LoadedAboutEntry } from '#replication/messages.ts'
import type { Timers } from '#replication/timers.ts'
import { is_record } from '#types/guards.ts'
import { linked_addresses, type PeerContext } from './context.ts'

export interface AnnouncedBy {
  // Every library the peer last announced, as untrusted hints.
  readonly hints: readonly AnnouncedLibrary[]
  // The addresses among them that authenticated.
  readonly verified: ReadonlySet<string>
}

export interface PeerAnnouncements {
  start: () => Promise<void>
  stop: () => Promise<void>
  announced_by: (peer_id: string) => AnnouncedBy | undefined
}

// The About entry of an open, non-empty library, with its payload inlined.
const loaded_about = async (context: PeerContext, library_address: string): Promise<LoadedAboutEntry | undefined> => {
  const oplog = context.libraries.get(library_address)?.oplog
  if (oplog === undefined || oplog.entries.size === 0) return undefined
  const entry = get_live_entry({ oplog, key: compute_about_id(library_address) })
  if (entry === undefined || !is_put(entry.operation)) return undefined
  const bytes = await context.content_store.get(entry.operation.value.content)
  const content = bytes === undefined ? undefined : decode_payload(bytes)
  return is_record(content) ? build_loaded_about_entry({ hash: entry.hash, entry: entry.entry, about_content: content }) : undefined
}

export const create_peer_announcements = ({ context, network, timers, get_block, on_peer_join, on_peer_leave }: {
  context: PeerContext
  network: Network
  timers: Timers
  // A block from the local store, or else fetched from peers under a timeout.
  get_block: (cid: string) => Promise<Uint8Array | undefined>
  on_peer_join: (peer_id: string) => void
  on_peer_leave: (peer_id: string) => void
}): PeerAnnouncements => {
  const { pubsub } = network
  const announced = new Map<string, { hints: AnnouncedLibrary[], verified: Set<string> }>()
  const removals: Array<() => void> = []

  const announcer = create_announcer({
    pubsub,
    interval_ms: context.config.announce_interval_ms,
    timers,
    build: async () => {
      const identity = context.identity
      if (identity === undefined) return undefined
      const about = await loaded_about(context, identity.own_address)
      if (about === undefined) return undefined
      const logs = await Promise.all(linked_addresses(context).map(async (address) => await loaded_about(context, address)))
      return encode_announcement({ about, logs: logs.filter((log) => log !== undefined) })
    }
  })

  // §5.3.4: one at a time, so a hostile announcement costs fetches serially.
  const authenticate = async (record: { hints: AnnouncedLibrary[], verified: Set<string> }) => {
    for (const hint of record.hints) {
      if (await authenticate_announced({ announced: hint, get_block }) !== undefined) record.verified.add(hint.address)
    }
  }

  const receive = ({ from, data }: PubSubMessage) => {
    const message = decode_announcement(data)
    if (message === undefined) return
    const record = { hints: [message.about, ...message.logs], verified: new Set<string>() }
    announced.set(from, record)
    authenticate(record).catch(() => {})
  }

  return {
    start: async () => {
      await pubsub.subscribe(RECORD_TOPIC, receive)
      removals.push(
        pubsub.on_peer_join(RECORD_TOPIC, (peer_id) => {
          announcer.peer_joined(peer_id)
          on_peer_join(peer_id)
        }),
        pubsub.on_peer_leave(RECORD_TOPIC, (peer_id) => {
          announced.delete(peer_id)
          on_peer_leave(peer_id)
        })
      )
      announcer.announce_self()
    },
    stop: async () => {
      announcer.stop()
      for (const remove of removals.splice(0)) remove()
      await pubsub.unsubscribe(RECORD_TOPIC)
    },
    announced_by: (peer_id) => announced.get(peer_id)
  }
}
