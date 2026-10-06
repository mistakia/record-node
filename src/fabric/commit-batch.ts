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

import type { DatabaseSync } from 'node:sqlite'

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
  // Commits an open batch now; no-op when none is open.
  flush: () => void
  // Flushes and stops the window timer. Call before the connection closes.
  close: () => void
}

export const create_commit_batcher = (db: DatabaseSync, policy: CommitPolicy): CommitBatcher => {
  let open = false
  let count = 0
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
      if (!open) db.exec('BEGIN')
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
      if (count >= policy.max_transactions) commit()
      else schedule()
    },
    flush: commit,
    close: commit
  }
}
