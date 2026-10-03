// Heads exchange on a library's topic (§5.4.1). The publisher coalesces every
// trigger inside one 1000 ms window into a single heads message, split into
// incomplete: true parts when the set outgrows the size bound. The receiver
// assembles each sender's parts and hands on only complete snapshots.

import type { PubSub, PubSubMessage } from '#fabric/pubsub.ts'
import { decode_heads_message, encode_heads_batches } from './messages.ts'
import type { Timers } from './timers.ts'

export interface HeadsPublisher {
  // A publication trigger: first subscribe, a peer join, or a heads change.
  trigger: () => void
  // Paused, triggers are dropped and a scheduled message is cancelled.
  pause: () => void
  resume: () => void
  // Resolves once every scheduled message has gone out.
  flushed: () => Promise<void>
}

export const create_heads_publisher = ({ pubsub, topic, interval_ms, get_heads, timers }: {
  pubsub: PubSub
  topic: string
  interval_ms: number
  get_heads: () => readonly string[]
  timers: Timers
}): HeadsPublisher => {
  let last_sent = -Infinity
  let scheduled: unknown
  let paused = false
  let sending: Promise<void> = Promise.resolve()

  const send = async () => {
    for (const data of encode_heads_batches({ heads: get_heads() })) {
      try {
        await pubsub.publish(topic, data)
      } catch (error) {
        process.emitWarning(`heads publish on ${topic} failed: ${(error as Error).message}`)
      }
    }
  }

  const flush = () => {
    scheduled = undefined
    if (paused) return
    last_sent = timers.now()
    sending = sending.then(send)
  }

  return {
    trigger: () => {
      if (paused || scheduled !== undefined) return
      scheduled = timers.set_timeout(flush, Math.max(0, last_sent + interval_ms - timers.now()))
    },
    pause: () => {
      paused = true
      if (scheduled !== undefined) timers.clear_timeout(scheduled)
      scheduled = undefined
    },
    resume: () => { paused = false },
    flushed: async () => { await sending }
  }
}

// A cap on one sender's pending parts, so a peer that never finishes a batch
// cannot grow it without bound.
const MAX_PENDING_HEADS = 1 << 16

export const create_heads_receiver = ({ on_snapshot }: {
  on_snapshot: (snapshot: { from: string, heads: readonly string[] }) => void
}) => {
  const pending = new Map<string, string[]>()
  return ({ from, data }: PubSubMessage): void => {
    const message = decode_heads_message(data)
    if (message === undefined) return
    const heads = [...(pending.get(from) ?? []), ...message.heads]
    if (message.incomplete) {
      if (heads.length > MAX_PENDING_HEADS) pending.delete(from)
      else pending.set(from, heads)
      return
    }
    pending.delete(from)
    on_snapshot({ from, heads })
  }
}
