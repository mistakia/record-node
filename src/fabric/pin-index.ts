// Pin accounting shared by the ContentStore backends (§4.6 item 6), in one
// SQLite file beside the blocks. Each block carries the number of pins that
// cover it, and each pinned root its kind, both keyed on the multihash, so a
// block reached through CIDs of different versions or codecs counts once.
// A pin or unpin walks its blocks, then changes every count in one
// synchronous transaction: concurrent pins of different roots never wait on
// each other, and a crash never tears a count.
//
// The index is derived. A library open pins its entries and kept blobs again
// unless its recorded pin set is clean (library pin record, below), and the
// identity library's pin records are pinned at start, so an index that is
// missing, of another version, or unreadable is replaced by an empty one and
// refilled by that pass.

import { rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { CID } from 'multiformats/cid'

import { walk_blocks } from './block.ts'
import type { CommitBatcher } from './commit-batch.ts'

const SCHEMA_VERSION = '1'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS block_pins (multihash BLOB PRIMARY KEY, refs INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS root_pins (multihash BLOB PRIMARY KEY, recursive INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS library_pin_sets (id INTEGER PRIMARY KEY, library TEXT NOT NULL UNIQUE, clean INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS library_pins (set_id INTEGER NOT NULL, cid TEXT NOT NULL, recursive INTEGER NOT NULL, PRIMARY KEY (set_id, cid)) WITHOUT ROWID;
`

const TABLES = ['meta', 'block_pins', 'root_pins', 'library_pin_sets', 'library_pins']

const open = (path: string): DatabaseSync => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  // A lost last transaction is repaired by the next open's pin pass.
  db.exec('PRAGMA synchronous = NORMAL')
  // As the query index (query-db/schema.ts): reads through the mapped file
  // and a cache larger than the 2 MB default.
  db.exec('PRAGMA cache_size = -32768')
  db.exec('PRAGMA mmap_size = 1073741824')
  const version = (() => {
    try {
      return (db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined)?.value
    } catch {
      return undefined
    }
  })()
  if (version !== SCHEMA_VERSION) {
    for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`)
  }
  db.exec(SCHEMA)
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION)
  return db
}

// A locked store is healthy and transient, never corrupt: the peer holds the
// write lock only while a batch is open, so deleting a file it could not open
// out from under the writer is the one outcome that must not happen.
const is_busy_error = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'errcode' in error &&
  (((error as { errcode: number }).errcode) & 0xff) === 5

// A file path, or ':memory:' for an index that lives as long as the process.
export const open_pin_db = (path = ':memory:'): DatabaseSync => {
  try {
    return open(path)
  } catch (error) {
    if (path === ':memory:' || is_busy_error(error)) throw error
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
    return open(path)
  }
}

// Runs fn as one transaction, through the batcher when there is one.
const in_transaction = (db: DatabaseSync, commit: CommitBatcher | undefined, fn: () => void) => {
  if (commit !== undefined) return commit.run(fn)
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export interface PinIndex {
  // Idempotent, and a recursive pin supersedes a direct one. Rejects with
  // content_unavailable when a block the pin covers is not stored.
  pin: (cid: CID, recursive: boolean) => Promise<void>
  // Removes the pin made on this CID, not one on an ancestor.
  unpin: (cid: CID) => Promise<void>
  is_pinned: (cid: CID) => boolean
  // Runs remove unless a pin covers the block or it is not stored. No pin
  // walks meanwhile, so none counts a block this deletes.
  evict: (cid: CID, remove: () => Promise<void>) => Promise<boolean>
}

export const create_pin_index = ({ db, read, has, commit }: {
  db: DatabaseSync
  read: (cid: CID) => Promise<Uint8Array | undefined>
  has: (cid: CID) => Promise<boolean>
  // Batches the per-pin transactions instead of committing each one; the
  // pin index is derived and refilled at open, so a lost batch is repaired.
  commit?: CommitBatcher | undefined
}): PinIndex => {
  const select_root = db.prepare('SELECT recursive FROM root_pins WHERE multihash = ?')
  const upsert_root = db.prepare('INSERT OR REPLACE INTO root_pins (multihash, recursive) VALUES (?, ?)')
  const delete_root = db.prepare('DELETE FROM root_pins WHERE multihash = ?')
  const select_block = db.prepare('SELECT refs FROM block_pins WHERE multihash = ?')
  const reference = db.prepare('INSERT INTO block_pins (multihash, refs) VALUES (?, 1) ON CONFLICT(multihash) DO UPDATE SET refs = refs + 1')
  const dereference = db.prepare('UPDATE block_pins SET refs = refs - 1 WHERE multihash = ?')
  const drop_released = db.prepare('DELETE FROM block_pins WHERE multihash = ? AND refs <= 0')

  const key = (cid: CID): Uint8Array => cid.multihash.bytes
  const root_kind = (cid: CID): boolean | undefined => {
    const row = select_root.get(key(cid)) as { recursive: number } | undefined
    return row === undefined ? undefined : row.recursive === 1
  }
  const transaction = (fn: () => void) => { in_transaction(db, commit, fn) }

  // Pin and unpin of one root run one at a time, so a walk always matches
  // the kind it was made for.
  const roots = new Map<string, Promise<unknown>>()
  const root_lock = async <T>(cid: CID, job: () => Promise<T>): Promise<T> => {
    const id = cid.multihash.toString()
    const run = (roots.get(id) ?? Promise.resolve()).then(job)
    const settled = run.catch(() => {})
    roots.set(id, settled)
    settled.then(() => { if (roots.get(id) === settled) roots.delete(id) }, () => {})
    return await run
  }

  // Pins walk side by side; an eviction waits for the walks in flight and
  // holds new ones until it is done.
  let walking = 0
  let walks_done: (() => void) | undefined
  let evicting: Promise<void> | undefined
  const walk_for_pin = async <T>(job: () => Promise<T>): Promise<T> => {
    // Checked again after every wait, in the same step that claims the gate.
    for (let current = evicting; current !== undefined; current = evicting) await current
    walking += 1
    try {
      return await job()
    } finally {
      walking -= 1
      if (walking === 0) walks_done?.()
    }
  }
  const exclusive_of_pins = async <T>(job: () => Promise<T>): Promise<T> => {
    for (let current = evicting; current !== undefined; current = evicting) await current
    let done = () => {}
    evicting = new Promise<void>((resolve) => { done = resolve })
    try {
      if (walking > 0) await new Promise<void>((resolve) => { walks_done = resolve })
      return await job()
    } finally {
      walks_done = undefined
      evicting = undefined
      done()
    }
  }

  const covered_by = async (cid: CID, recursive: boolean) => await walk_blocks({ cid, recursive, read, has })

  return {
    pin: async (cid, recursive) => {
      await root_lock(cid, async () => {
        const kind = root_kind(cid)
        if (kind === true || (kind === false && !recursive)) return
        await walk_for_pin(async () => {
          const covered = await covered_by(cid, recursive)
          transaction(() => {
            // A direct pin already counts the root itself.
            for (const block of kind === false ? covered.slice(1) : covered) reference.run(key(block))
            upsert_root.run(key(cid), recursive ? 1 : 0)
          })
        })
      })
    },
    unpin: async (cid) => {
      await root_lock(cid, async () => {
        const kind = root_kind(cid)
        if (kind === undefined) return
        const covered = await covered_by(cid, kind)
        transaction(() => {
          delete_root.run(key(cid))
          for (const block of covered) {
            dereference.run(key(block))
            drop_released.run(key(block))
          }
        })
      })
    },
    is_pinned: (cid) => select_block.get(key(cid)) !== undefined,
    evict: async (cid, remove) => await exclusive_of_pins(async () => {
      if (select_block.get(key(cid)) !== undefined || !(await has(cid))) return false
      await remove()
      return true
    })
  }
}

// Each library's pin set as the library manager holds it, CID to whether the
// pin is recursive, so an open can take it back instead of re-reading every
// entry's payload to rebuild it. The rows change with the set, on the pin
// index's own connection and batch, after the pins they record. A set is
// clean only while no change to it is in flight and a full pass has filled
// it since it was last cleared: begin marks it dirty before a change writes,
// and settle marks it clean after, so a crash in between leaves it dirty and
// the next open re-pins in full.
export interface LibraryPinRecord {
  // The recorded set, or undefined unless it is clean.
  load: (library_address: string) => Map<string, boolean> | undefined
  begin: (library_address: string) => void
  set: (library_address: string, pins: ReadonlyArray<readonly [string, boolean]>) => void
  delete: (library_address: string, cids: readonly string[]) => void
  settle: (library_address: string) => void
  // Drops the set, dirty, for a full pass to refill, or for good at unlink.
  clear: (library_address: string) => void
}

export const create_library_pin_record = ({ db, commit }: { db: DatabaseSync, commit?: CommitBatcher | undefined }): LibraryPinRecord => {
  const select_set = db.prepare('SELECT id, clean FROM library_pin_sets WHERE library = ?')
  const insert_set = db.prepare('INSERT INTO library_pin_sets (library, clean) VALUES (?, 0) ON CONFLICT(library) DO NOTHING')
  const set_clean = db.prepare('UPDATE library_pin_sets SET clean = ? WHERE library = ?')
  const delete_set = db.prepare('DELETE FROM library_pin_sets WHERE library = ?')
  const select_pins = db.prepare('SELECT cid, recursive FROM library_pins WHERE set_id = ?')
  const upsert_pin = db.prepare('INSERT INTO library_pins (set_id, cid, recursive) VALUES (?, ?, ?) ON CONFLICT(set_id, cid) DO UPDATE SET recursive = excluded.recursive')
  const delete_pin = db.prepare('DELETE FROM library_pins WHERE set_id = ? AND cid = ?')
  const delete_pins = db.prepare('DELETE FROM library_pins WHERE set_id = ?')

  const set_id = (library_address: string): number => {
    insert_set.run(library_address)
    return (select_set.get(library_address) as { id: number }).id
  }
  const transaction = (fn: () => void) => { in_transaction(db, commit, fn) }

  return {
    load: (library_address) => {
      const row = select_set.get(library_address) as { id: number, clean: number } | undefined
      if (row?.clean !== 1) return undefined
      const pins = new Map<string, boolean>()
      for (const { cid, recursive } of select_pins.all(row.id) as Array<{ cid: string, recursive: number }>) pins.set(cid, recursive === 1)
      return pins
    },
    begin: (library_address) => { transaction(() => { set_clean.run(0, library_address) }) },
    set: (library_address, pins) => {
      if (pins.length === 0) return
      transaction(() => {
        const id = set_id(library_address)
        for (const [cid, recursive] of pins) upsert_pin.run(id, cid, recursive ? 1 : 0)
      })
    },
    delete: (library_address, cids) => {
      const row = select_set.get(library_address) as { id: number } | undefined
      if (row === undefined || cids.length === 0) return
      transaction(() => { for (const cid of cids) delete_pin.run(row.id, cid) })
    },
    settle: (library_address) => {
      transaction(() => {
        set_id(library_address)
        set_clean.run(1, library_address)
      })
    },
    clear: (library_address) => {
      const row = select_set.get(library_address) as { id: number } | undefined
      if (row === undefined) return
      transaction(() => {
        delete_pins.run(row.id)
        delete_set.run(library_address)
      })
    }
  }
}
