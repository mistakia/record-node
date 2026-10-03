// Content replication (§4.6.1, §4.6.2, §5.4.6): the audio and artwork a
// library's replication policy keeps, and the blobs the identity library
// pins, fetched from peers over the content channel and pinned recursively.
// Fetches are bounded: a fixed number in flight, a timeout per blob, and a
// retry under backoff for one that fails, so a blob no peer serves never
// stalls log replication or another blob. Its track stays listed.

import { canonical_cid } from '#entry/identity-record.ts'
import { is_put } from '#entry/operations.ts'
import { read_unixfs_file } from '#fabric/unixfs.ts'
import type { Network } from '#fabric/network.ts'
import type { VerifiedEntry } from '#oplog/accept.ts'
import type { Timers } from '#replication/timers.ts'
import { ProtocolError } from '#types/errors.ts'
import type { PeerContext } from './context.ts'
import { stored_track_content, track_blobs } from './pins.ts'
import { keeps_blobs } from './policy.ts'

const RETRY_FIRST_MS = 30_000
const RETRY_MAX_MS = 30 * 60_000

// Who wants a blob kept: libraries whose policy keeps it, or a pin record.
interface Job {
  readonly cid: string
  readonly libraries: Set<string>
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
  // Resolves once no fetch is in flight.
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
  const in_flight = new Set<Promise<void>>()
  let retained = new Set<string>()
  let timer: unknown
  let stopped = false
  // Stop aborts every fetch in flight, so a peer never waits out a deadline.
  const stopping = new AbortController()

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

  // A paused library suspends its fetches (§4.6.1); a pin applies regardless.
  const wanted = (job: Job): boolean =>
    job.pinned || [...job.libraries].some((address) => context.replication?.get(address)?.state() !== 'paused')

  const land = async (job: Job) => {
    if (job.pinned) await content_store.pin(job.cid, { recursive: true })
    for (const library_address of job.libraries) {
      if (libraries.get(library_address) !== undefined) await libraries.hold_blobs({ library_address, cids: [job.cid] })
    }
    if (job.pinned) context.events.emit({ type: 'track:pinned', payload: { cid: canonical_cid(job.cid) } })
  }

  const running = new Set<string>()

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
      schedule()
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
    const now = timers.now()
    for (const job of jobs.values()) {
      if (running.size >= config.traversal_concurrency) return
      if (running.has(job.cid) || job.retry_at > now || !wanted(job)) continue
      run(job)
    }
  }

  // Wakes the queue when the earliest retry falls due.
  function schedule () {
    if (stopped) return
    if (timer !== undefined) timers.clear_timeout(timer)
    const due = Math.min(...[...jobs.values()].map(({ retry_at }) => retry_at))
    if (!Number.isFinite(due)) return
    timer = timers.set_timeout(() => {
      timer = undefined
      pump()
    }, Math.max(0, due - timers.now()))
  }

  const want = ({ cid, library_address, pinned = false }: { cid: string, library_address?: string, pinned?: boolean }) => {
    const job = jobs.get(cid) ?? { cid, libraries: new Set<string>(), pinned: false, attempts: 0, retry_at: 0 }
    if (library_address !== undefined) job.libraries.add(library_address)
    job.pinned ||= pinned
    jobs.set(cid, job)
  }

  // A blob whose blocks are local is held at once; any other is fetched.
  const keep_library_blobs = async (library_address: string, entries: readonly VerifiedEntry[]) => {
    const handle = libraries.get(library_address)
    if (handle === undefined) return
    const keeps = keeps_blobs(context)(library_address)
    for (const entry of entries) {
      if (!is_put(entry.operation) || entry.operation.value.type !== 'track') continue
      if (handle.oplog.current.get(entry.operation.key) !== entry) continue
      const content = await stored_track_content({ content_store, content_cid: entry.operation.value.content })
      if (content === undefined || !keeps({ entry, content })) continue
      const cids = track_blobs(content)
      await libraries.hold_blobs({ library_address, cids })
      for (const cid of cids) if (handle.pins.get(cid) !== true) want({ cid, library_address })
    }
    pump()
  }

  const live_tracks = (library_address: string): VerifiedEntry[] =>
    [...libraries.get(library_address)?.oplog.current.values() ?? []].filter((entry) => is_put(entry.operation) && entry.operation.value.type === 'track')

  return {
    entries: keep_library_blobs,
    policy_changed: async (library_address) => {
      const handle = libraries.get(library_address)
      if (handle === undefined) return
      const keeps = keeps_blobs(context)(library_address)
      const released: string[] = []
      for (const entry of live_tracks(library_address)) {
        const content = await stored_track_content({ content_store, content_cid: (entry.operation as { value: { content: string } }).value.content })
        if (content !== undefined && !keeps({ entry, content })) released.push(...track_blobs(content))
      }
      for (const job of jobs.values()) job.libraries.delete(library_address)
      await libraries.release_blobs({ library_address, cids: released })
      await keep_library_blobs(library_address, live_tracks(library_address))
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
      // A removed pin releases the blob unless a library still keeps it.
      const kept = new Set(libraries.list().flatMap(({ pins: held }) => [...held].filter(([, recursive]) => recursive).map(([cid]) => canonical_cid(cid))))
      for (const cid of previous) {
        if (pins.has(cid)) continue
        const job = jobs.get(cid)
        if (job !== undefined) {
          job.pinned = false
          if (job.libraries.size === 0) jobs.delete(cid)
        }
        if (!kept.has(cid)) await content_store.unpin(cid)
        context.events.emit({ type: 'track:unpinned', payload: { cid } })
      }
      pump()
    },
    retained: () => retained,
    retry: () => {
      for (const job of jobs.values()) job.retry_at = 0
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
    }
  }
}
