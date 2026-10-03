// One replicator on the in-memory network with a remote member to send it
// heads, over a library DAG the test controls, recording every publish and
// fetch in one ordered log.

import type { ResolvedAcChain } from '#access-control/resolve.ts'
import { create_memory_content_store } from '#adapter/memory/content-store.ts'
import { create_memory_network } from '#adapter/memory/network.ts'
import type { PubSub } from '#fabric/pubsub.ts'
import type { HashedEntry } from '#entry/signed.ts'
import { create_oplog } from '#oplog/dag.ts'
import { merge_entries } from '#oplog/merge.ts'
import { decode_heads_message, encode_heads_batches } from '#replication/messages.ts'
import { create_replicator } from '#replication/replicator.ts'
import { SYSTEM_TIMERS, type Timers } from '#replication/timers.ts'
import { wait_until } from './network.ts'

export const create_replicator_rig = ({ chain, fetch, timers = SYSTEM_TIMERS, concurrency = 4, timeout_ms = 5000, merge_delay }: {
  chain: ResolvedAcChain
  fetch: (hash: string, options: { signal: AbortSignal }) => Promise<Uint8Array | undefined>
  timers?: Timers
  concurrency?: number
  timeout_ms?: number
  // Awaited inside each merge, to hold it open.
  merge_delay?: () => Promise<void>
}) => {
  const network = create_memory_network()
  const local = network.join({ content_store: create_memory_content_store() })
  const remote = network.join({ content_store: create_memory_content_store() })
  const oplog = create_oplog({ chain })
  const log: string[] = []
  const batches: HashedEntry[][] = []
  let merging = 0
  let peak_merging = 0
  const pubsub: PubSub = {
    ...local.pubsub,
    publish: async (topic, data) => {
      log.push(`publish:${topic}`)
      await local.pubsub.publish(topic, data)
    }
  }
  const replicator = create_replicator({
    oplog,
    pubsub,
    fetch_block: async (hash, options) => {
      log.push(`fetch:${hash}`)
      return await fetch(hash, options)
    },
    merge: async (entries) => {
      peak_merging = Math.max(peak_merging, ++merging)
      batches.push(entries)
      await merge_delay?.()
      merge_entries({ oplog, blocks: entries.map(({ bytes }) => bytes) })
      merging--
    },
    concurrency,
    timeout_ms,
    heads_interval_ms: 1000,
    timers
  })

  // Heads the local peer published, decoded, in order.
  const published_heads = () => network.published
    .filter(({ from, topic }) => from === local.peer_id && topic === chain.address)
    .map(({ data }) => decode_heads_message(data))

  // Publishes heads from the remote member and waits until each of these
  // messages, by identity, has reached the local peer.
  const send_heads = async (heads: readonly string[], sender = remote) => {
    const parts = encode_heads_batches({ heads })
    for (const data of parts) await sender.pubsub.publish(chain.address, data)
    const arrived = (data: Uint8Array) => network.delivered.some((delivery) => delivery.to === local.peer_id && delivery.data === data)
    await wait_until(() => parts.every(arrived))
  }

  return { network, local, remote, oplog, log, batches, replicator, published_heads, send_heads, peak_merging: () => peak_merging }
}
