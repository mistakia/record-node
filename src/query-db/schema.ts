// The derived query index (§4.7). Every table is a projection of oplog
// entries plus the content payloads they point at, so the whole database can
// be dropped and rebuilt by replay. The schema is not protocol and is never
// exchanged with peers.

import { DatabaseSync } from 'node:sqlite'

// Dependents first, so a drop never trips over an index or a view.
export const QUERY_TABLES = ['entries', 'tracks', 'tags', 'resolvers', 'logs', 'about', 'listens'] as const

export type QueryTable = typeof QUERY_TABLES[number]

const SCHEMA = `
  -- The current entry per (library, key) under §4.4.2. A current DEL stays as
  -- a row with op DEL: that is the tombstone.
  CREATE TABLE IF NOT EXISTS entries (
    library_address TEXT NOT NULL,
    key TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('PUT', 'DEL')),
    type TEXT NOT NULL CHECK (type IN ('track', 'log', 'about')),
    clock_time INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY (library_address, key)
  ) WITHOUT ROWID;

  -- Live tracks. Content columns stay null while the content payload is not
  -- in the local store.
  CREATE TABLE IF NOT EXISTS tracks (
    library_address TEXT NOT NULL,
    track_id TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    content_cid TEXT NOT NULL,
    audio_cid TEXT,
    audio_size_bytes INTEGER,
    title TEXT,
    artist TEXT,
    artists TEXT NOT NULL DEFAULT '[]',
    album TEXT,
    album_artist TEXT,
    remixer TEXT,
    genre TEXT NOT NULL DEFAULT '[]',
    bpm REAL,
    duration_seconds REAL,
    bitrate REAL,
    codec TEXT,
    sample_rate REAL,
    lossless INTEGER,
    artwork TEXT NOT NULL DEFAULT '[]',
    added_at_ms INTEGER NOT NULL,
    PRIMARY KEY (library_address, track_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS tracks_by_track_id ON tracks (track_id);

  -- Envelope labels of live tracks (§2.4.3).
  CREATE TABLE IF NOT EXISTS tags (
    library_address TEXT NOT NULL,
    track_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (library_address, track_id, tag)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS tags_by_tag ON tags (tag, track_id);
  CREATE INDEX IF NOT EXISTS tags_by_track_id ON tags (track_id);

  -- Source pointers of live tracks (§2.4.2), enumerated fields only.
  CREATE TABLE IF NOT EXISTS resolvers (
    library_address TEXT NOT NULL,
    track_id TEXT NOT NULL,
    extractor TEXT NOT NULL,
    id TEXT NOT NULL,
    fulltitle TEXT,
    thumbnail TEXT,
    artist TEXT,
    alt_title TEXT,
    upload_date TEXT,
    webpage_url TEXT,
    duration_seconds REAL,
    PRIMARY KEY (library_address, track_id, extractor, id)
  ) WITHOUT ROWID;

  -- Live links to other libraries (§2.5). linked_address is null while the
  -- log payload is not in the local store.
  CREATE TABLE IF NOT EXISTS logs (
    library_address TEXT NOT NULL,
    log_id TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    linked_address TEXT,
    alias TEXT,
    PRIMARY KEY (library_address, log_id)
  ) WITHOUT ROWID;

  -- Library profiles (§2.6), keyed by about id. Only payloads present in the
  -- local store produce a row.
  CREATE TABLE IF NOT EXISTS about (
    library_address TEXT NOT NULL,
    about_id TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    name TEXT,
    bio TEXT,
    location TEXT,
    avatar TEXT,
    PRIMARY KEY (library_address, about_id)
  ) WITHOUT ROWID;

  -- Every listen in a listens library (§2.7). Append-only, keyed by entry.
  CREATE TABLE IF NOT EXISTS listens (
    library_address TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    track_id TEXT NOT NULL,
    address TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY (library_address, entry_hash)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS listens_by_track_id ON listens (track_id, timestamp);
`

export const apply_schema = (db: DatabaseSync): void => {
  db.exec(SCHEMA)
}

export const drop_schema = (db: DatabaseSync): void => {
  for (const table of QUERY_TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`)
}

// A file path, or ':memory:' for an index that lives as long as the process.
export const open_query_db = ({ path = ':memory:' }: { path?: string } = {}): DatabaseSync => {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  apply_schema(db)
  return db
}

// Runs fn inside one transaction, rolled back if it throws.
export const in_transaction = <T>(db: DatabaseSync, fn: () => T): T => {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
