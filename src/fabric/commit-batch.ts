// Batching SQLite commit wrapper for a store on a single write connection.
//
// A DatabaseSync write commits synchronously on the JS thread, and under
// dirty-page writeback on a slow image each COMMIT stalls that thread for the
// whole flush. The stores this wraps (the pin index and the query index) are
// derived: a crash may lose the last transactions, never tear one, and the
// next open refills them, so we are free to defer COMMIT for a short window
// and let a batch of writes pay one commit stall instead of each paying its
// own. Readers on the same connection see the uncommitted rows, as the stores
// already relied on inside their own transactions.
//
// The window keeps the deferral bounded even under low traffic, and a batch is
// atomic in WAL, so a crash loses whole batches, never a torn one — the same
// contract a lost single transaction already had. A throwing run rolls the
// whole open batch back: the batch is small and its contents are rebuilt by
// the next open, so a rollback costs at most a few derived writes.
//
// A batch begins IMMEDIATE, taking the writer lock up front: the store's WAL
// checkpointer (wal-checkpointer.ts) briefly holds that lock to truncate the
// WAL, and SQLite waits out a busy lock at BEGIN but fails a read-to-write
// upgrade at once. With a checkpointer, each commit nudges it, and a hold that
// would begin with the WAL past its bound first commits any open batch and
// awaits a drain, which is what keeps the WAL bounded under continuous writes.

import type { DatabaseSync } from 'node:sqlite'

import type { WalCheckpointer } from './wal-checkpointer.ts'

export interface CommitPolicy {
  // Commits an open batch after it has sat this long without a new run.
  window_ms: number
  // Commits an open batch once this many runs have accumulated.
  max_transactions: number
}

export const DEFAULT_COMMIT_POLICY: CommitPolicy = { window_ms: 100, max_transactions: 8 }

export interface CommitBatcher {
  // Applies fn under the open batch, auto-committing at the policy limits.
  run: (fn: () => void) => void
  // Runs job with commits held: the runs it makes, and any others meanwhile,
  // join one batch that commits as the last hold ends, so a write of many
  // entries pays one commit stall instead of one per max_transactions runs.
  hold: <T>(job: () => Promise<T>) => Promise<T>
  // Commits an open batch now; no-op when none is open.
  flush: () => void
  // Flushes and stops the window timer. Call before the connection closes.
  close: () => void
}

export const create_commit_batcher = (db: DatabaseSync, policy: CommitPolicy, checkpointer?: WalCheckpointer): CommitBatcher => {
  let open = false
  let count = 0
  let holds = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const stop_timer = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const commit = () => {
    try {
      if (open) {
        // Closed before the COMMIT, so a throw here cannot make a later
        // close() try to COMMIT the same transaction again.
        open = false
        count = 0
        db.exec('COMMIT')
        checkpointer?.nudge()
      }
    } finally {
      // Always disarm the timer: a throw from the COMMIT must not leave it
      // armed to fire against a connection that has since closed.
      stop_timer()
    }
  }
  const schedule = () => {
    if (timer === undefined) {
      timer = setTimeout(commit, policy.window_ms)
      if (typeof timer.unref === 'function') timer.unref()
    }
  }

  return {
    run (fn) {
      if (!open) db.exec('BEGIN IMMEDIATE')
      open = true
      try {
        fn()
      } catch (error) {
        db.exec('ROLLBACK')
        open = false
        count = 0
        stop_timer()
        throw error
      }
      count += 1
      if (holds > 0) return
      if (count >= policy.max_transactions) commit()
      else schedule()
    },
    async hold (job) {
      if (holds === 0 && checkpointer?.over_bound() === true) {
        commit()
        await checkpointer.drain()
      }
      holds += 1
      try {
        return await job()
      } finally {
        holds -= 1
        if (holds === 0) commit()
      }
    },
    flush: commit,
    close: commit
  }
}
