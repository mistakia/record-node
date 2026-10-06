// The commit batcher: defers COMMIT so a batch of runs pays one commit stall,
// rolls back wholesale on a throw, and always drains on close. A second
// connection observes what has actually been committed (WAL gives it a clean
// snapshot), which is how the deferral is made visible.

import { expect, test } from 'bun:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'

import { create_commit_batcher, type CommitBatcher } from '#fabric/commit-batch.ts'

const settle = async () => await new Promise((resolve) => setTimeout(resolve, 60))

// A file-backed store pair: writer with WAL (like the real stores), and a
// reader that sees only committed frames. Returns the table writer and a
// function that counts committed rows.
const pair = () => {
  const dir = mkdtempSync('/tmp/commit-batch-')
  const path = `${dir}/store.sqlite`
  const writer = new DatabaseSync(path)
  writer.exec('PRAGMA journal_mode = WAL')
  writer.exec('CREATE TABLE IF NOT EXISTS t (x TEXT)')
  const read = () => {
    const reader = new DatabaseSync(path)
    const row = reader.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }
    reader.close()
    return row.n
  }
  const cleanup = () => {
    writer.close()
    rmSync(dir, { recursive: true, force: true })
  }
  return { writer, read, cleanup }
}

test('holds writes uncommitted then flushes them as one batch', async () => {
  const { writer, read, cleanup } = pair()
  try {
    const batch: CommitBatcher = create_commit_batcher(writer, { window_ms: 60_000, max_transactions: 99 })
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('a'))
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('b'))
    expect(read()).toBe(0)
    batch.flush()
    expect(read()).toBe(2)
  } finally {
    cleanup()
  }
})

test('auto-commits once max_transactions runs accumulate', async () => {
  const { writer, read, cleanup } = pair()
  try {
    const batch = create_commit_batcher(writer, { window_ms: 60_000, max_transactions: 2 })
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('a'))
    expect(read()).toBe(0)
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('b'))
    expect(read()).toBe(2)
  } finally {
    cleanup()
  }
})

test('window timer drains a low-traffic batch on its own', async () => {
  const { writer, read, cleanup } = pair()
  try {
    const batch = create_commit_batcher(writer, { window_ms: 30, max_transactions: 99 })
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('a'))
    await settle()
    expect(read()).toBe(1)
    batch.close()
  } finally {
    cleanup()
  }
})

test('a throwing run rolls the whole open batch back and re-throws', async () => {
  const { writer, read, cleanup } = pair()
  try {
    const batch = create_commit_batcher(writer, { window_ms: 60_000, max_transactions: 99 })
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('a'))
    expect(() => batch.run(() => { throw new Error('boom') })).toThrow('boom')
    expect(read()).toBe(0)
    // The store is still usable: the next run starts a fresh batch.
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('c'))
    batch.flush()
    expect(read()).toBe(1)
  } finally {
    cleanup()
  }
})

test('close flushes an open batch', async () => {
  const { writer, read, cleanup } = pair()
  try {
    const batch = create_commit_batcher(writer, { window_ms: 60_000, max_transactions: 99 })
    batch.run(() => writer.prepare('INSERT INTO t (x) VALUES (?)').run('a'))
    batch.close()
    expect(read()).toBe(1)
  } finally {
    cleanup()
  }
})
