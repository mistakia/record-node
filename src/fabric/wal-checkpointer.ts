// WAL checkpoints off the event loop for a store on a single write connection.
//
// With SQLite's default wal_autocheckpoint, the COMMIT that carries the WAL
// past 1000 pages checkpoints synchronously on the JS thread, fsyncs included.
// On base-storage's direct-io image that checkpoint, not the commit, was the
// event-loop stall: commit p50 0.79 s with the default, 3.4 ms with the
// checkpoint moved to a worker. So the write connection never checkpoints
// itself, and a worker thread holding its own connection does it instead.
//
// The worker only ever runs PASSIVE checkpoints, which take no lock the
// writer waits on, so nothing the worker does can stall or fail a write. A
// PASSIVE pass copies the committed frames into the database file; once one
// has caught up with every frame, SQLite rewinds the WAL at the next write
// and that write's commit cuts the file back to journal_size_limit.
//
// Under continuous writes a pass never catches up, so the bound comes from
// the writer: a held batch (CommitBatcher.hold) that would begin with the WAL
// past truncate_bytes first awaits drain(), which has the worker pass until it
// catches up while the writer waits. The event loop stays free meanwhile; only
// the next large write waits, and never longer than drain_timeout_ms.
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
  // WAL size past which a held batch first drains; also the size SQLite cuts
  // a rewound WAL back to.
  truncate_bytes: number
  // Longest a held batch waits for a drain before it goes ahead anyway.
  drain_timeout_ms: number
}

export const DEFAULT_WAL_CHECKPOINT_POLICY: WalCheckpointPolicy = { interval_ms: 500, truncate_bytes: 64 * 1024 * 1024, drain_timeout_ms: 10_000 }

export interface WalCheckpointer {
  // Notes a commit, so a pass runs within interval_ms.
  nudge: () => void
  // Whether the WAL is past truncate_bytes, so a large write should drain first.
  over_bound: () => boolean
  // Resolves once the WAL is within truncate_bytes, or the worker has caught
  // up with every committed frame, or drain_timeout_ms has passed. Call with
  // no batch open, so the next write can rewind the WAL.
  drain: () => Promise<void>
  // Runs a final checkpoint and ends the worker. Call after the last commit
  // and before the write connection closes.
  stop: () => Promise<void>
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const { DatabaseSync } = require('node:sqlite')
const { path, interval_ms } = workerData
const db = new DatabaseSync(path)
// One PASSIVE pass; true when every committed frame is in the database file.
const pass = () => {
  try {
    const { busy, log, checkpointed } = db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get()
    return busy === 0 && log === checkpointed
  } catch (error) {
    parentPort.postMessage({ type: 'error', message: error.message })
    return false
  }
}
let last = Date.now()
let timer
let draining
const scheduled = () => {
  timer = undefined
  last = Date.now()
  pass()
}
// Passes a turn apart until one catches up or the deadline passes.
const drain = (id, deadline) => {
  draining = undefined
  if (pass() || Date.now() >= deadline) {
    parentPort.postMessage({ type: 'drained', id })
    return
  }
  draining = setTimeout(() => { drain(id, deadline) }, 5)
}
parentPort.on('message', (message) => {
  if (message.type === 'nudge') {
    if (timer === undefined) timer = setTimeout(scheduled, Math.max(0, last + interval_ms - Date.now()))
  } else if (message.type === 'drain') {
    if (draining !== undefined) clearTimeout(draining)
    drain(message.id, Date.now() + message.timeout_ms)
  } else if (message.type === 'stop') {
    if (timer !== undefined) clearTimeout(timer)
    if (draining !== undefined) clearTimeout(draining)
    pass()
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
  // A WAL SQLite rewinds is cut back to the bound, not left at its high-water size.
  db.exec(`PRAGMA journal_size_limit = ${policy.truncate_bytes}`)
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { path, interval_ms: policy.interval_ms }
  })
  // Idle, the worker never holds the process open; a pending drain or stop
  // refs it, so awaiting either keeps Node alive until it answers.
  worker.unref()
  let stopping = false
  let alive = true
  let next_drain = 0
  let draining: { id: number, promise: Promise<void>, resolve: () => void } | undefined
  const end_drain = () => {
    if (draining === undefined) return
    draining.resolve()
    draining = undefined
    if (alive) worker.unref()
  }
  const fall_back = (reason: string) => {
    if (!alive) return
    alive = false
    end_drain()
    process.emitWarning(`WAL checkpointer for ${path} ended (${reason}); the write connection checkpoints itself`)
    db.exec('PRAGMA wal_autocheckpoint = 1000')
  }
  worker.on('message', (message: { type: string, id?: number, message?: string }) => {
    if (message.type === 'drained' && message.id === draining?.id) end_drain()
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
      if (!alive || stopping || wal_bytes(path) <= policy.truncate_bytes) return
      // Callers arriving meanwhile share the one drain.
      if (draining === undefined) {
        const id = ++next_drain
        let settle = () => {}
        const promise = new Promise<void>((resolve) => { settle = resolve })
        draining = { id, promise, resolve: settle }
        worker.ref()
        worker.postMessage({ type: 'drain', id, timeout_ms: policy.drain_timeout_ms })
        // A pass already under way may outlast the worker's own deadline.
        const timer = setTimeout(() => { if (draining?.id === id) end_drain() }, policy.drain_timeout_ms)
        timer.unref()
      }
      await draining.promise
    },
    async stop () {
      if (stopping) return
      stopping = true
      end_drain()
      if (!alive) return
      alive = false
      // The worker exits once it has checkpointed and closed its connection.
      worker.ref()
      await new Promise<void>((resolve) => {
        worker.once('exit', () => { resolve() })
        worker.postMessage({ type: 'stop' })
      })
    }
  }
}
