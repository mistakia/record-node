// The data-directory lock (§8.4.6): an exclusive lock taken before anything
// else in the directory opens, held while the node runs, and released by the
// operating system when the process dies, so a held lock always means a live
// process. It is an SQLite exclusive-mode lock on <data_dir>/lock: fcntl on
// POSIX and LockFileEx on Windows, both dropped with the process.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const LOCK_FILE_NAME = 'lock'

// A distinct error, so a host that spawned the node can tell a held
// directory from any other start failure.
export class DataDirectoryLocked extends Error {
  readonly code = 'data_dir_locked'

  constructor (data_dir: string) {
    super(`the data directory ${data_dir} is locked by another running node`)
    this.name = 'DataDirectoryLocked'
  }
}

export interface DataDirectoryLock {
  release: () => void
}

export const lock_data_dir = (data_dir: string): DataDirectoryLock => {
  mkdirSync(data_dir, { recursive: true })
  const db = new DatabaseSync(join(data_dir, LOCK_FILE_NAME))
  try {
    db.exec('PRAGMA busy_timeout = 0')
    db.exec('PRAGMA locking_mode = EXCLUSIVE')
    // In exclusive mode the write lock this takes is kept after COMMIT.
    db.exec('BEGIN EXCLUSIVE')
    db.exec('COMMIT')
  } catch (error) {
    db.close()
    if ((error as { errcode?: number }).errcode === 5) throw new DataDirectoryLocked(data_dir)
    throw error
  }
  return { release: () => { db.close() } }
}
