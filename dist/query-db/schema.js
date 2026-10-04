// The derived query index (§4.7). Every table is a projection of oplog
// entries plus the content payloads they point at, or a copy of the entries
// themselves, so the whole database can be dropped and rebuilt by replay.
// The schema is not protocol and is never exchanged with peers.
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
// Dependents first, so a drop never trips over an index or a view.
export const QUERY_TABLES = ['entries', 'tracks', 'tags', 'resolvers', 'logs', 'about', 'listens', 'library_heads', 'meta'];
// Not projections, so a rebuild by replay leaves them empty and each library's
// next open refills them.
const ENTRY_BLOCK_TABLES = ['entry_blocks', 'entry_blocks_verified'];
// Bump when the schema changes, so an index written by an older version is
// dropped and rebuilt by replay at the next open instead of being misread. A
// table added empty, whose absence nothing misreads, needs no bump: every
// open applies the schema.
export const SCHEMA_VERSION = 1;
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

  -- Per-library projection markers (§4.7): the library's entry heads at the
  -- moment its rows were last written, and the keys whose content payload was
  -- missing then. A restart whose freshly-loaded oplog has the same heads skips
  -- the full replay and re-projects only the pending keys, so rows fill in
  -- when a payload arrived while the peer was down.
  CREATE TABLE IF NOT EXISTS library_heads (
    library_address TEXT PRIMARY KEY,
    heads TEXT NOT NULL,
    pending TEXT NOT NULL
  ) WITHOUT ROWID;

  -- Each library's verified signed-entry blocks, so a restart reads its
  -- oplog in one scan (entry-blocks.ts). Empty is valid: the open walks the
  -- blockstore and fills it.
  CREATE TABLE IF NOT EXISTS entry_blocks (
    library_address TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (library_address, entry_hash)
  ) WITHOUT ROWID;

  -- Per library, the heads of the oplog its cached blocks were last written
  -- from and the verification rules version that oplog was verified under, so
  -- an open restores a matching cache without verifying each entry again
  -- (entry-blocks.ts). A missing row means verify in full.
  CREATE TABLE IF NOT EXISTS entry_blocks_verified (
    library_address TEXT PRIMARY KEY,
    heads TEXT NOT NULL,
    rules_version INTEGER NOT NULL
  ) WITHOUT ROWID;

  -- Schema version, for §4.7 rebuilds on schema change. Not protocol.
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
`;
const STAMP_VERSION = "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
export const apply_schema = (db) => {
    db.exec(SCHEMA);
    db.prepare(STAMP_VERSION).run(String(SCHEMA_VERSION));
};
export const drop_schema = (db) => {
    for (const table of [...QUERY_TABLES, ...ENTRY_BLOCK_TABLES])
        db.exec(`DROP TABLE IF EXISTS ${table}`);
};
// The written schema version, or undefined when the version cannot be read
// (a fresh file, an older schema without meta, or a corrupt one).
const stored_version = (db) => {
    try {
        const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
        return row?.value;
    }
    catch {
        return undefined;
    }
};
const open = (path) => {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    // The index is derived (§4.7): a crash may lose its last transactions, but
    // never tear one, and rows and heads marker commit together, so the next
    // open finds the marker behind the oplog and re-projects. So no commit
    // waits on an fsync, which costs ingest dearly on a slow disk.
    db.exec('PRAGMA synchronous = NORMAL');
    // An older or unreadable schema: drop every table and start over. The
    // next library open finds no marker and rebuilds the index by replay.
    if (stored_version(db) !== String(SCHEMA_VERSION))
        drop_schema(db);
    apply_schema(db);
    return db;
};
// A file path, or ':memory:' for an index that lives as long as the process.
// A missing, corrupt, or unreadable file is removed and rebuilt: the survivor
// replays every library at its next open, so the index can never be misread.
export const open_query_db = ({ path = ':memory:' } = {}) => {
    try {
        return open(path);
    }
    catch (error) {
        if (path === ':memory:')
            throw error;
        rmSync(`${path}-wal`, { force: true });
        rmSync(`${path}-shm`, { force: true });
        rmSync(path, { force: true });
        return open(path);
    }
};
// Runs fn inside one transaction, rolled back if it throws.
export const in_transaction = (db, fn) => {
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
};
