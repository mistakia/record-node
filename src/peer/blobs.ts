// Content replication (§4.6.1, §4.6.2, §5.4.6): the audio, artwork, and
// avatar a library's replication policy keeps, and the blobs the identity library
// pins, fetched from peers over the content channel and pinned recursively.
// Fetches are bounded: a fixed number in flight, a timeout per blob, and a
// retry under backoff for one that fails, so a blob no peer serves never
// stalls log replication or another blob. Its track stays listed.

import { canonical_cid } from '#entry/identity-record.ts'
import { read_unixfs_file } from '#fabric/unixfs.ts'
import type { Network } from '#fabric/network.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import type { Timers } from '#replication/timers.ts'
import { ProtocolError } from '#types/errors.ts'
import type { PeerContext } from './context.ts'
import { has_item_6, stored_item_6 } from './pins.ts'
import { keeps_blobs } from './policy.ts'

const RETRY_FIRST_MS = 30_000
const RETRY_MAX_MS = 30 * 60_000

// Who wants a blob kept: libraries whose policy keeps it, each at the policy
// generation that asked, or a pin record.
interface Job {
  readonly cid: string
  readonly libraries: Map<string, number>
  pinned: boolean
  attempts: number
  retry_at: number
}

export interface BlobKeeper {
  // Entries merged, reindexed, or appended in a library: hold or fetch the
  // item 6 its policy keeps.
  entries: (library_address: string, entries: readonly VerifiedEntry[]) => Promise<void>
  // The library's policy changed: hold or fetch what it now keeps, and
  // release what it no longer does.
  policy_changed: (library_address: string) => Promise<void>
  // The identity library's pins: the canonical CIDs to keep (§4.6.2).
  sync_pins: (pins: ReadonlySet<string>) => Promise<void>
  // Canonical CIDs pinned by pin records, which no library releases.
  retained: () => ReadonlySet<string>
  // A peer joined or replication resumed: retry what is waiting.
  retry: () => void
  // Resolves once no fetch or hold is in flight.
  settled: () => Promise<void>
  stop: () => void
}

export const create_blob_keeper = ({ context, network, timers, timeout_ms }: {
  context: PeerContext
  network: Network | undefined
  timers: Timers
  timeout_ms: number
}): BlobKeeper => {
  const { content_store, libraries, config } = context
  const jobs = new Map<string, Job>()
  // Jobs due now, in order, read from ready_at on; and jobs waiting out a
  // retry or a paused library.
  let ready: string[] = []
  let ready_at = 0
  const waiting = new Set<string>()
  const running = new Set<string>()
  const in_flight = new Set<Promise<void>>()
  // Bumped on every policy change, so a decision made under an earlier
  // policy never pins after the change released it.
  const generations = new Map<string, number>()
  let retained = new Set<string>()
  let timer: unknown
  // When the armed timer fires: the earliest retry it serves.
  let timer_due = Number.POSITIVE_INFINITY
  let stopped = false
  // Stop aborts every fetch in flight, so a peer never waits out a deadline.
  const stopping = new AbortController()

  const generation = (library_address: string) => generations.get(library_address) ?? 0

  // Every block of the blob, local or fetched from peers under one deadline.
  const fetch_blob = async (cid: string): Promise<boolean> => {
    const signal = AbortSignal.any([AbortSignal.timeout(timeout_ms), stopping.signal])
    try {
      const bytes = await read_unixfs_file({
        cid,
        read: async (block) => await content_store.get(block) ??
          (network === undefined || signal.aborted ? undefined : await network.fetch_block(block, { signal }))
      })
      return bytes !== undefined
    } catch (error) {
      if (error instanceof ProtocolError) return false
      throw error
    }
  }

  // Libraries whose policy still wants the blob at the generation that asked.
  const current_libraries = (job: Job): string[] =>
    [...job.libraries].filter(([address, asked]) => generation(address) === asked).map(([address]) => address)

  // A paused library suspends its fetches (§4.6.1); a pin applies regardless.
  const wanted_now = (job: Job): boolean =>
    job.pinned || current_libraries(job).some((address) => context.replication?.get(address)?.state() !== 'paused')

  const forget_if_unowned = (job: Job) => {
    if (job.pinned || current_libraries(job).length > 0) return
    jobs.delete(job.cid)
    waiting.delete(job.cid)
  }

  const land = async (job: Job) => {
    if (job.pinned) {
      await content_store.pin(job.cid, { recursive: true })
      context.events.emit({ type: 'track:pinned', payload: { cid: canonical_cid(job.cid) } })
    }
    for (const library_address of current_libraries(job)) await libraries.hold_blobs({ library_address, cids: [job.cid] })
  }

  // Arms the timer for a retry falling due at `due`, unless it is armed
  // sooner. When it fires, one pass moves every due job to ready and re-arms
  // for the earliest one left, so a retry costs no scan of its own.
  const schedule = (due: number) => {
    if (stopped || due >= timer_due) return
    if (timer !== undefined) timers.clear_timeout(timer)
    timer_due = due
    timer = timers.set_timeout(() => {
      timer = undefined
      timer_due = Number.POSITIVE_INFINITY
      const now = timers.now()
      let next = Number.POSITIVE_INFINITY
      for (const cid of [...waiting]) {
        const job = jobs.get(cid)
        if (job === undefined) {
          waiting.delete(cid)
        } else if (job.retry_at > now) {
          next = Math.min(next, job.retry_at)
        } else if (wanted_now(job)) {
          waiting.delete(cid)
          ready.push(cid)
        }
      }
      pump()
      if (Number.isFinite(next)) schedule(next)
    }, Math.max(0, due - timers.now()))
  }

  const run = (job: Job) => {
    running.add(job.cid)
    const attempt: Promise<void> = (async () => {
      if (await fetch_blob(job.cid) && !stopped) {
        jobs.delete(job.cid)
        await land(job)
        return
      }
      job.attempts += 1
      job.retry_at = timers.now() + Math.min(RETRY_FIRST_MS * 2 ** (job.attempts - 1), RETRY_MAX_MS)
      waiting.add(job.cid)
      schedule(job.retry_at)
    })()
      .catch((error: unknown) => { process.emitWarning(`blob fetch for ${job.cid} failed: ${(error as Error).message}`) })
      .finally(() => {
        running.delete(job.cid)
        in_flight.delete(attempt)
        pump()
      })
    in_flight.add(attempt)
  }

  function pump () {
    if (stopped) return
    while (running.size < config.traversal_concurrency && ready_at < ready.length) {
      const cid = ready[ready_at++] as string
      if (ready_at > 1024 && ready_at * 2 > ready.length) {
        ready = ready.slice(ready_at)
        ready_at = 0
      }
      const job = jobs.get(cid)
      if (job === undefined || running.has(cid)) continue
      forget_if_unowned(job)
      if (!jobs.has(cid)) continue
      if (!wanted_now(job)) {
        waiting.add(cid)
        continue
      }
      run(job)
    }
  }

  const want = ({ cid, library_address, pinned = false }: { cid: string, library_address?: string, pinned?: boolean }) => {
    const existing = jobs.get(cid)
    const job = existing ?? { cid, libraries: new Map<string, number>(), pinned: false, attempts: 0, retry_at: 0 }
    if (library_address !== undefined) job.libraries.set(library_address, generation(library_address))
    job.pinned ||= pinned
    if (existing === undefined) {
      jobs.set(cid, job)
      ready.push(cid)
    }
  }

  // A blob whose blocks are local is held at once; any other is fetched. The
  // policy is read once, and a change made meanwhile wins.
  const keep_library_blobs = async (library_address: string, entries: readonly VerifiedEntry[]) => {
    const handle = libraries.get(library_address)
    if (handle === undefined) return
    const asked = generation(library_address)
    const keeps = keeps_blobs(context)(handle.chain)
    for (const entry of entries) {
      if (!has_item_6(entry) || handle.oplog.current.get(entry.state_key as string) !== entry) continue
      const item = await stored_item_6({ content_store, library_address, entry })
      if (item === undefined || !keeps({ entry, content: item.content })) continue
      if (generation(library_address) !== asked) return
      const cids = item.blobs
      await libraries.hold_blobs({ library_address, cids })
      for (const cid of cids) if (handle.pins.get(cid) !== true) want({ cid, library_address })
    }
    pump()
  }

  const live_item_6_entries = (library_address: string): VerifiedEntry[] =>
    [...libraries.get(library_address)?.oplog.current.values() ?? []].filter(has_item_6)

  return {
    // Tracked with the fetches, so settled waits for its holds; none starts once stopped.
    entries: async (library_address, entries) => {
      if (stopped) return
      const keeping = keep_library_blobs(library_address, entries)
      const tracked = keeping.catch(() => {})
      in_flight.add(tracked)
      try {
        await keeping
      } finally {
        in_flight.delete(tracked)
      }
    },
    policy_changed: async (library_address) => {
      const handle = libraries.get(library_address)
      if (handle === undefined) return
      generations.set(library_address, generation(library_address) + 1)
      const keeps = keeps_blobs(context)(handle.chain)
      const released: string[] = []
      for (const entry of live_item_6_entries(library_address)) {
        const item = await stored_item_6({ content_store, library_address, entry })
        if (item !== undefined && !keeps({ entry, content: item.content })) released.push(...item.blobs)
      }
      await libraries.release_blobs({ library_address, cids: released })
      await keep_library_blobs(library_address, live_item_6_entries(library_address))
    },
    sync_pins: async (pins) => {
      const previous = retained
      retained = new Set(pins)
      for (const cid of pins) {
        if (previous.has(cid)) continue
        try {
          await content_store.pin(cid, { recursive: true })
          context.events.emit({ type: 'track:pinned', payload: { cid } })
        } catch (error) {
          if (!(error instanceof ProtocolError && error.code === 'content_unavailable')) throw error
          want({ cid, pinned: true })
        }
      }
      const removed = [...previous].filter((cid) => !pins.has(cid))
      if (removed.length > 0) {
        // A removed pin releases the blob unless a library still keeps it,
        // judged once every open's re-pin pass has filled its pin set.
        await libraries.pins_settled()
        const kept = new Set(libraries.list().flatMap(({ pins: held }) =>
          [...held].flatMap(([cid, recursive]) => recursive ? [canonical_cid(cid)] : [])))
        for (const cid of removed) {
          const job = jobs.get(cid)
          if (job !== undefined) {
            job.pinned = false
            forget_if_unowned(job)
          }
          if (!kept.has(cid)) await content_store.unpin(cid)
          context.events.emit({ type: 'track:unpinned', payload: { cid } })
        }
      }
      pump()
    },
    retained: () => retained,
    retry: () => {
      for (const cid of waiting) {
        const job = jobs.get(cid)
        if (job !== undefined) job.retry_at = 0
      }
      ready = [...ready.slice(ready_at), ...waiting]
      ready_at = 0
      waiting.clear()
      pump()
    },
    settled: async () => {
      while (in_flight.size > 0) await Promise.allSettled([...in_flight])
    },
    stop: () => {
      stopped = true
      stopping.abort()
      if (timer !== undefined) timers.clear_timeout(timer)
      jobs.clear()
      ready = []
      ready_at = 0
      waiting.clear()
    }
  }
}
