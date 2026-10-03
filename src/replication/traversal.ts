// Bounded fetch traversal (§5.4.2): from heads along the union of next and
// refs, each hash enqueued once, at most `concurrency` fetches in flight,
// each under a timeout that records the entry unresolved rather than holding
// the traversal. An entry that fails verification, the fan-out cap included,
// is abandoned and enqueues none of its children. Pausable and resumable
// (§5.4.4): resume re-enters at the earliest unresolved entry and never
// re-fetches one that already landed.

import { ProtocolError } from '#types/errors.ts'
import type { Timers } from './timers.ts'

export interface TraversedEntry {
  readonly hash: string
  readonly entry: { readonly next: readonly string[], readonly refs: readonly string[] }
}

export interface Traversal {
  // Enqueues hashes not seen before, and retries any of them left unresolved.
  enqueue: (hashes: Iterable<string>) => void
  // In-flight fetches run on, recorded as unresolved until they land.
  pause: () => void
  resume: () => void
  // Drops every queue and record, for unlink.
  discard: () => void
  // Resolves when no fetch is in flight and, unless paused, none is queued.
  idle: () => Promise<void>
  readonly enqueued: ReadonlySet<string>
  readonly unresolved: () => string[]
  readonly rejected: ReadonlyMap<string, ProtocolError>
  // Enqueued hashes neither fetched nor abandoned.
  readonly outstanding: () => number
}

export const create_traversal = <T extends TraversedEntry>({ fetch, verify, is_landed, on_entry, on_change, concurrency, timeout_ms, timers }: {
  fetch: (hash: string, options: { signal: AbortSignal }) => Promise<Uint8Array | undefined>
  // Throws a ProtocolError for an entry to abandon.
  verify: (hash: string, bytes: Uint8Array) => T
  // Already in the local oplog: never fetched.
  is_landed: (hash: string) => boolean
  on_entry: (entry: T) => void
  on_change?: () => void
  concurrency: number
  timeout_ms: number
  timers: Timers
}): Traversal => {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('traversal concurrency must be a finite positive integer')
  if (!Number.isFinite(timeout_ms) || timeout_ms <= 0) throw new RangeError('traversal timeout must be finite and positive')
  const enqueued = new Set<string>()
  const fetched = new Set<string>()
  const unresolved = new Set<string>()
  const rejected = new Map<string, ProtocolError>()
  const in_flight = new Map<string, { controller: AbortController, timer: unknown }>()
  let queue: string[] = []
  let paused = false
  let waiters: Array<() => void> = []

  const is_idle = () => in_flight.size === 0 && (paused || queue.length === 0)

  const changed = () => {
    on_change?.()
    if (!is_idle()) return
    const resolved = waiters
    waiters = []
    for (const resolve of resolved) resolve()
  }

  const settle = (hash: string, record: unknown): boolean => {
    if (in_flight.get(hash) !== record) return false
    timers.clear_timeout(in_flight.get(hash)?.timer)
    in_flight.delete(hash)
    return true
  }

  const land = (hash: string, bytes: Uint8Array) => {
    unresolved.delete(hash)
    let entry: T
    try {
      entry = verify(hash, bytes)
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error
      rejected.set(hash, error)
      return
    }
    fetched.add(hash)
    on_entry(entry)
    add([...entry.entry.next, ...entry.entry.refs])
  }

  const start = (hash: string) => {
    const controller = new AbortController()
    const record = { controller, timer: undefined as unknown }
    in_flight.set(hash, record)
    record.timer = timers.set_timeout(() => {
      if (!settle(hash, record)) return
      controller.abort()
      unresolved.add(hash)
      pump()
    }, timeout_ms)
    fetch(hash, { signal: controller.signal }).then(
      (bytes) => {
        if (!settle(hash, record)) return
        if (bytes === undefined) unresolved.add(hash)
        else land(hash, bytes)
        pump()
      },
      () => {
        if (!settle(hash, record)) return
        unresolved.add(hash)
        pump()
      }
    )
  }

  const pump = () => {
    if (!paused) {
      while (in_flight.size < concurrency && queue.length > 0) {
        const hash = queue.shift() as string
        if (!is_landed(hash) && !fetched.has(hash) && !in_flight.has(hash)) start(hash)
      }
    }
    changed()
  }

  const add = (hashes: Iterable<string>) => {
    for (const hash of hashes) {
      if (is_landed(hash)) continue
      if (!enqueued.has(hash)) {
        enqueued.add(hash)
        queue.push(hash)
      } else if (unresolved.has(hash) && !in_flight.has(hash)) {
        unresolved.delete(hash)
        queue.push(hash)
      }
    }
  }

  return {
    enqueue: (hashes) => {
      add(hashes)
      pump()
    },
    pause: () => {
      paused = true
      for (const hash of in_flight.keys()) unresolved.add(hash)
      changed()
    },
    resume: () => {
      paused = false
      for (const hash of unresolved) {
        if (is_landed(hash)) unresolved.delete(hash)
      }
      const retry = [...unresolved].filter((hash) => !in_flight.has(hash))
      for (const hash of retry) unresolved.delete(hash)
      queue = [...retry, ...queue.filter((hash) => !retry.includes(hash))]
      pump()
    },
    discard: () => {
      for (const [hash, record] of in_flight) {
        settle(hash, record)
        record.controller.abort()
      }
      queue = []
      enqueued.clear()
      fetched.clear()
      unresolved.clear()
      rejected.clear()
      changed()
    },
    idle: async () => {
      if (is_idle()) return
      await new Promise<void>((resolve) => { waiters.push(resolve) })
    },
    enqueued,
    unresolved: () => [...unresolved],
    rejected,
    outstanding: () => new Set([...queue, ...in_flight.keys(), ...unresolved]).size
  }
}
