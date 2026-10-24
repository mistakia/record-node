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
// The worker body is evaluated source, not a module file, so the same code
// runs under Bun from src/, under Node from dist/, and inside record-app's
// packaged utility process, with no worker path to resolve in any of them.

import type { DatabaseSync } from 'node:sqlite'
import { Worker } from 'node:worker_threads'

export interface WalCheckpointPolicy {
  // Least time between two checkpoint passes; a pass runs only after a commit.
  interval_ms: number
  // The size SQLite cuts a rewound WAL back to.
  truncate_bytes: number
}

export const DEFAULT_WAL_CHECKPOINT_POLICY: WalCheckpointPolicy = { interval_ms: 500, truncate_bytes: 64 * 1024 * 1024 }

export interface WalCheckpointer {
  // Notes a commit, so a pass runs within interval_ms.
  nudge: () => void
  // Runs a final checkpoint and ends the worker. Call after the last commit
  // and before the write connection closes.
  stop: () => Promise<void>
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const { DatabaseSync } = require('node:sqlite')
const { path, interval_ms } = workerData
const db = new DatabaseSync(path)
// One PASSIVE pass.
const pass = () => {
  try {
    db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get()
  } catch (error) {
    parentPort.postMessage({ type: 'error', message: error.message })
  }
}
let last = Date.now()
let timer
const scheduled = () => {
  timer = undefined
  last = Date.now()
  pass()
}
parentPort.on('message', (message) => {
  if (message.type === 'nudge') {
    if (timer === undefined) timer = setTimeout(scheduled, Math.max(0, last + interval_ms - Date.now()))
  } else if (message.type === 'stop') {
    if (timer !== undefined) clearTimeout(timer)
    pass()
    db.close()
    parentPort.close()
  }
})
`

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
  // Idle, the worker never holds the process open; a pending stop refs it,
  // so awaiting it keeps Node alive until it answers.
  worker.unref()
  let stopping = false
  let alive = true
  const fall_back = (reason: string) => {
    if (!alive) return
    alive = false
    process.emitWarning(`WAL checkpointer for ${path} ended (${reason}); the write connection checkpoints itself`)
    db.exec('PRAGMA wal_autocheckpoint = 1000')
  }
  worker.on('message', (message: { type: string, message?: string }) => {
    if (message.type === 'error') process.emitWarning(`WAL checkpoint of ${path} failed: ${message.message ?? ''}`)
  })
  worker.on('error', (error: Error) => { if (!stopping) fall_back(error.message) })
  worker.on('exit', (code) => { if (!stopping) fall_back(`exit ${code}`) })

  return {
    nudge () {
      if (alive) worker.postMessage({ type: 'nudge' })
    },
    async stop () {
      if (stopping) return
      stopping = true
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
