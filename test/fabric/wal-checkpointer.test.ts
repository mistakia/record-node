// The WAL checkpointer: the write connection never checkpoints, a worker
// does, the WAL stays bounded under steady writes, a crash before any
// checkpoint loses no committed batch, and under Node a pending stop keeps
// the process alive.

import { afterEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { create_commit_batcher } from '#fabric/commit-batch.ts'
import { start_wal_checkpointer, type WalCheckpointer, type WalCheckpointPolicy } from '#fabric/wal-checkpointer.ts'

const wal_bytes = (path: string): number => {
  try {
    return statSync(`${path}-wal`).size
  } catch {
    return 0
  }
}

const ROW = new Uint8Array(4096)
const BOUND = 256 * 1024
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

// A WAL store with one table, cleaned up after the test even when it fails.
const store = (policy?: Partial<WalCheckpointPolicy>) => {
  const dir = mkdtempSync('/tmp/wal-checkpointer-')
  const path = `${dir}/store.sqlite`
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('CREATE TABLE t (x BLOB)')
  const checkpointer = policy === undefined
    ? undefined
    : start_wal_checkpointer({ db, path, policy: { interval_ms: 5, truncate_bytes: BOUND, ...policy } })
  const count = () => {
    const reader = new DatabaseSync(path)
    const row = reader.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }
    reader.close()
    return row.n
  }
  cleanups.push(async () => {
    await checkpointer?.stop()
    if (db.isOpen) db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { path, db, checkpointer: checkpointer as WalCheckpointer, count, insert: db.prepare('INSERT INTO t (x) VALUES (?)') }
}

const sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms))

test('keeps the WAL bounded under steady small batches, and within it at close', async () => {
  const { path, db, checkpointer, count, insert } = store({})
  const batch = create_commit_batcher(db, { window_ms: 1, max_transactions: 4 }, checkpointer)
  let peak = 0
  // About 4 MB in 64 KB batches, an ingest's pace: a short gap after each.
  for (let round = 0; round < 250; round++) {
    for (let row = 0; row < 4; row++) batch.run(() => insert.run(ROW))
    peak = Math.max(peak, wal_bytes(path))
    await sleep(20)
  }
  batch.close()
  expect(peak).toBeLessThan(2 * BOUND)
  await checkpointer.stop()
  db.close()
  expect(wal_bytes(path)).toBeLessThanOrEqual(BOUND)
  expect(count()).toBe(1000)
}, 20_000)

test('the write connection never checkpoints on its own', () => {
  const { path, insert } = store({ interval_ms: 60_000, truncate_bytes: 1 << 30 })
  // Well past the default 1000-page autocheckpoint, with no nudge.
  for (let row = 0; row < 2000; row++) insert.run(ROW)
  expect(wal_bytes(path)).toBeGreaterThan(2000 * 4096)
})

test('a crash before any checkpoint keeps every committed batch', () => {
  const { path, db, count } = store()
  db.close()
  // A child commits through the batcher and exits without closing, before
  // the worker's first pass is due, so the next open replays its WAL.
  const child = spawnSync(process.execPath, ['-e', `
    import { DatabaseSync } from 'node:sqlite'
    import { create_commit_batcher } from '#fabric/commit-batch.ts'
    import { start_wal_checkpointer } from '#fabric/wal-checkpointer.ts'
    const db = new DatabaseSync(${JSON.stringify(path)})
    const checkpointer = start_wal_checkpointer({ db, path: ${JSON.stringify(path)}, policy: { interval_ms: 60_000, truncate_bytes: 1 << 30 } })
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
})

test('under Node, a pending stop keeps the process alive until the worker is done', () => {
  const { path, db } = store()
  db.close()
  // dist/ is the Node build of src/ (check:dist keeps it current), and
  // nothing but the stop holds the event loop open.
  const child = spawnSync('node', ['--no-warnings', '--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite'
    import { start_wal_checkpointer } from '#fabric/wal-checkpointer.ts'
    const db = new DatabaseSync(${JSON.stringify(path)})
    const checkpointer = start_wal_checkpointer({ db, path: ${JSON.stringify(path)} })
    db.prepare('INSERT INTO t (x) VALUES (?)').run(new Uint8Array(4096))
    checkpointer.stop().then(() => { db.close(); console.log('stopped') })
  `], { cwd: process.cwd(), encoding: 'utf8' })
  expect(child.stderr).toBe('')
  expect(child.stdout.trim()).toBe('stopped')
})
