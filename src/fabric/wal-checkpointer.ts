// WAL checkpoints off the event loop for a store on a single write connection.
//
// With SQLite's default wal_autocheckpoint, the COMMIT that carries the WAL
// past 1000 pages checkpoints synchronously on the JS thread, fsyncs included.
// On base-storage's direct-io image that checkpoint, not the commit, was the
// event-loop stall: commit p50 0.79 s with the default, 3.4 ms with the
// checkpoint moved to a worker. So the write connection never checkpoints
// itself, and a worker thread holding its own connection does it instead.
//
// The worker never waits on a lock, so it can never hold one the writer waits
// on for long. It runs PASSIVE checkpoints, which take no writer lock, and once
// one has copied every committed frame it tries TRUNCATE without waiting: that
// succeeds only while no batch is open, and then has next to nothing left to
// copy, so its hold on the writer lock is short. The write connection waits
// that out with a busy_timeout, and begins its batches IMMEDIATE
// (commit-batch.ts) so the wait happens at BEGIN, where SQLite honors the
// timeout, rather than at a read-to-write upgrade, where it does not.
//
// Under continuous writes a PASSIVE pass never catches up, so the bound comes
// from the writer: a held batch (CommitBatcher.hold) that would begin with the
// WAL past truncate_bytes first awaits drain(), which has the worker checkpoint
// until it catches up and truncates. The event loop stays free meanwhile; only
// the next large write waits. A WAL the worker could not truncate is rewound by
// SQLite at the next write and cut back to journal_size_limit.
//
// The worker body is evaluated source, not a module file, so the same code
// runs under Bun from src/, under Node from dist/, and inside record-app's
// packaged utility process, with no worker path to resolve in any of them.

import { statSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'

export interface WalCheckpointPolicy {
  // Least time between two checkpoint passes; a pass runs only after a commit.
  interval_ms: number
  // WAL size past which the worker truncates once caught up, and a held
  // batch first drains.
  truncate_bytes: number
  // Longest a held batch waits for a drain before it goes ahead anyway.
  drain_timeout_ms: number
}

export const DEFAULT_WAL_CHECKPOINT_POLICY: WalCheckpointPolicy = { interval_ms: 500, truncate_bytes: 64 * 1024 * 1024, drain_timeout_ms: 10_000 }

// How long the write connection waits out the worker's short TRUNCATE hold
// before failing a write.
const WRITER_BUSY_TIMEOUT_MS = 5000

export interface WalCheckpointer {
  // Notes a commit, so a pass runs within interval_ms.
  nudge: () => void
  // Whether the WAL is past truncate_bytes, so a large write should drain first.
  over_bound: () => boolean
  // Resolves once the WAL is within truncate_bytes, or the worker has caught
  // up with every committed frame, or drain_timeout_ms has passed. Call with
  // no batch open.
  drain: () => Promise<void>
  // Runs a final checkpoint and ends the worker. Call after the last commit
  // and before the write connection closes.
  stop: () => Promise<void>
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const { statSync } = require('node:fs')
const { DatabaseSync } = require('node:sqlite')
const { path, interval_ms, truncate_bytes } = workerData
const db = new DatabaseSync(path)
// Never wait on a lock: a busy one means the writer is mid-batch, and the
// next pass tries again.
db.exec('PRAGMA busy_timeout = 0')
const wal_bytes = () => {
  try { return statSync(path + '-wal').size } catch { return 0 }
}
const checkpoint = (mode) => db.prepare('PRAGMA wal_checkpoint(' + mode + ')').get()
// One PASSIVE pass, then a TRUNCATE when it caught up and the WAL is over the
// bound. True when every committed frame is in the database file.
const pass = (bound) => {
  try {
    const { busy, log, checkpointed } = checkpoint('PASSIVE')
    const caught_up = busy === 0 && log === checkpointed
    if (caught_up && wal_bytes() > bound) checkpoint('TRUNCATE')
    return caught_up
  } catch (error) {
    parentPort.postMessage({ type: 'error', message: error.message })
    return false
  }
}
let last = 0
let timer
const scheduled = () => {
  timer = undefined
  last = Date.now()
  pass(truncate_bytes)
}
// Passes back to back, a turn apart, until one catches up or the deadline.
const drain = (deadline) => {
  if (pass(truncate_bytes) || Date.now() >= deadline) {
    parentPort.postMessage({ type: 'drained' })
    return
  }
  setTimeout(() => { drain(deadline) }, 5)
}
parentPort.on('message', (message) => {
  if (message.type === 'nudge') {
    if (timer === undefined) timer = setTimeout(scheduled, Math.max(0, last + interval_ms - Date.now()))
  } else if (message.type === 'drain') {
    drain(Date.now() + message.timeout_ms)
  } else if (message.type === 'stop') {
    if (timer !== undefined) clearTimeout(timer)
    pass(0)
    db.close()
    parentPort.close()
  }
})
`

const wal_bytes = (path: string): number => {
  try {
    return statSync(`${path}-wal`).size
  } catch {
    return 0
  }
}

// Hands db's checkpoints to a worker. db must be the store's only writer, on
// a file path in WAL mode. If the worker dies, db checkpoints itself again.
export const start_wal_checkpointer = ({ db, path, policy = DEFAULT_WAL_CHECKPOINT_POLICY }: {
  db: DatabaseSync
  path: string
  policy?: WalCheckpointPolicy
}): WalCheckpointer => {
  db.exec('PRAGMA wal_autocheckpoint = 0')
  db.exec(`PRAGMA busy_timeout = ${WRITER_BUSY_TIMEOUT_MS}`)
  // A WAL SQLite rewinds is cut back to the bound, not left at its high-water size.
  db.exec(`PRAGMA journal_size_limit = ${policy.truncate_bytes}`)
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { path, interval_ms: policy.interval_ms, truncate_bytes: policy.truncate_bytes }
  })
  worker.unref()
  let stopping = false
  let alive = true
  let draining: Promise<void> | undefined
  let drained: (() => void) | undefined
  const fall_back = (reason: string) => {
    if (!alive) return
    alive = false
    drained?.()
    process.emitWarning(`WAL checkpointer for ${path} ended (${reason}); the write connection checkpoints itself`)
    db.exec('PRAGMA wal_autocheckpoint = 1000')
  }
  worker.on('message', (message: { type: string, message?: string }) => {
    if (message.type === 'drained') drained?.()
    else if (message.type === 'error') process.emitWarning(`WAL checkpoint of ${path} failed: ${message.message ?? ''}`)
  })
  worker.on('error', (error: Error) => { if (!stopping) fall_back(error.message) })
  worker.on('exit', (code) => { if (!stopping) fall_back(`exit ${code}`) })

  return {
    nudge () {
      if (alive) worker.postMessage({ type: 'nudge' })
    },
    over_bound: () => alive && wal_bytes(path) > policy.truncate_bytes,
    async drain () {
      if (!alive || wal_bytes(path) <= policy.truncate_bytes) return
      // Callers arriving meanwhile share the one drain.
      draining ??= new Promise<void>((resolve) => {
        drained = () => {
          drained = undefined
          draining = undefined
          resolve()
        }
        worker.postMessage({ type: 'drain', timeout_ms: policy.drain_timeout_ms })
      })
      await draining
    },
    async stop () {
      if (stopping) return
      stopping = true
      drained?.()
      if (!alive) return
      alive = false
      // The worker exits once it has checkpointed and closed its connection.
      await new Promise<void>((resolve) => {
        worker.once('exit', () => { resolve() })
        worker.postMessage({ type: 'stop' })
      })
    }
  }
}
