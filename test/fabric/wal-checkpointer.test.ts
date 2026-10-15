// The WAL checkpointer: the write connection never checkpoints, a worker
// does, the WAL stays bounded under continuous writes, stop leaves it empty,
// and a crash before any checkpoint loses no committed batch.

import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { create_commit_batcher } from '#fabric/commit-batch.ts'
import { start_wal_checkpointer } from '#fabric/wal-checkpointer.ts'

const wal_bytes = (path: string): number => {
  try {
    return statSync(`${path}-wal`).size
  } catch {
    return 0
  }
}

const store = () => {
  const dir = mkdtempSync('/tmp/wal-checkpointer-')
  const path = `${dir}/store.sqlite`
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('CREATE TABLE t (x BLOB)')
  const count = () => {
    const reader = new DatabaseSync(path)
    const row = reader.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }
    reader.close()
    return row.n
  }
  return { dir, path, db, count, cleanup: () => { rmSync(dir, { recursive: true, force: true }) } }
}

const ROW = new Uint8Array(4096)

test('keeps the WAL bounded under continuous writes, and stop leaves it empty', async () => {
  const { path, db, count, cleanup } = store()
  try {
    const truncate_bytes = 256 * 1024
    const checkpointer = start_wal_checkpointer({ db, path, policy: { interval_ms: 5, truncate_bytes, drain_timeout_ms: 10_000 } })
    const batch = create_commit_batcher(db, { window_ms: 1, max_transactions: 4 }, checkpointer)
    const insert = db.prepare('INSERT INTO t (x) VALUES (?)')
    let peak = 0
    // About 16 MB written, with a turn between batches as a busy node has.
    for (let round = 0; round < 1000; round++) {
      for (let row = 0; row < 4; row++) batch.run(() => insert.run(ROW))
      peak = Math.max(peak, wal_bytes(path))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    batch.close()
    expect(peak).toBeLessThan(8 * truncate_bytes)
    await checkpointer.stop()
    expect(wal_bytes(path)).toBe(0)
    expect(count()).toBe(4000)
    db.close()
  } finally {
    cleanup()
  }
})

test('a held batch drains first, keeping the WAL bounded under back-to-back large batches', async () => {
  const { path, db, count, cleanup } = store()
  try {
    const truncate_bytes = 256 * 1024
    const checkpointer = start_wal_checkpointer({ db, path, policy: { interval_ms: 60_000, truncate_bytes, drain_timeout_ms: 10_000 } })
    const batch = create_commit_batcher(db, { window_ms: 60_000, max_transactions: 1000 }, checkpointer)
    const insert = db.prepare('INSERT INTO t (x) VALUES (?)')
    let peak = 0
    // Each hold writes about 1 MB, four times the bound, with no idle time
    // between holds for a PASSIVE pass to catch up in.
    for (let round = 0; round < 40; round++) {
      await batch.hold(async () => {
        for (let row = 0; row < 250; row++) batch.run(() => insert.run(ROW))
      })
      peak = Math.max(peak, wal_bytes(path))
    }
    expect(peak).toBeLessThan(truncate_bytes + 3 * 250 * 4096 * 1.1)
    await checkpointer.stop()
    expect(wal_bytes(path)).toBe(0)
    expect(count()).toBe(10_000)
    db.close()
  } finally {
    cleanup()
  }
})

test('the write connection never checkpoints on its own', async () => {
  const { path, db, cleanup } = store()
  try {
    const checkpointer = start_wal_checkpointer({ db, path, policy: { interval_ms: 60_000, truncate_bytes: 1 << 30, drain_timeout_ms: 10_000 } })
    // Well past the default 1000-page autocheckpoint, with no nudge.
    const insert = db.prepare('INSERT INTO t (x) VALUES (?)')
    for (let row = 0; row < 2000; row++) insert.run(ROW)
    expect(wal_bytes(path)).toBeGreaterThan(2000 * 4096)
    await checkpointer.stop()
    db.close()
  } finally {
    cleanup()
  }
})

test('a crash before any checkpoint keeps every committed batch', () => {
  const { path, db, count, cleanup } = store()
  db.close()
  try {
    // A child commits through the batcher and exits without closing, so its
    // WAL is never checkpointed; the next open replays it.
    const child = spawnSync(process.execPath, ['-e', `
      import { DatabaseSync } from 'node:sqlite'
      import { create_commit_batcher } from '#fabric/commit-batch.ts'
      import { start_wal_checkpointer } from '#fabric/wal-checkpointer.ts'
      const db = new DatabaseSync(${JSON.stringify(path)})
      const checkpointer = start_wal_checkpointer({ db, path: ${JSON.stringify(path)}, policy: { interval_ms: 60_000, truncate_bytes: 1 << 30, drain_timeout_ms: 10_000 } })
      const batch = create_commit_batcher(db, { window_ms: 60_000, max_transactions: 99 }, checkpointer)
      const insert = db.prepare('INSERT INTO t (x) VALUES (?)')
      for (let row = 0; row < 500; row++) batch.run(() => insert.run(new Uint8Array(4096)))
      batch.flush()
      batch.run(() => insert.run(new Uint8Array(4096)))
      process.exit(1)
    `], { cwd: process.cwd(), encoding: 'utf8' })
    expect(child.status).toBe(1)
    expect(wal_bytes(path)).toBeGreaterThan(500 * 4096)
    // The flushed batch survives; the open one is lost whole.
    expect(count()).toBe(500)
  } finally {
    cleanup()
  }
})
