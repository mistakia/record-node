// The derived query index (§4.7). Every table is a projection of oplog
// entries plus the content payloads they point at, or a copy of the entries
// themselves, so the whole database can be dropped and rebuilt by replay.
// The schema is not protocol and is never exchanged with peers.
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
// Dependents first, so a drop never trips over an index or a view.
export const QUERY_TABLES = ['entries', 'tracks', 'tags', 'resolvers', 'about', 'listens', 'library_heads', 'library_totals', 'meta'];
// Not projections, so a rebuild by replay leaves them empty and each library's
// next open refills them.
const ENTRY_BLOCK_TABLES = ['entry_blocks', 'entry_blocks_verified'];
// The track search index (TRACK_SEARCH_SCHEMA), which triggers derive from
// tracks; its rowids follow insertion order, so it is no projection to compare.
const SEARCH_TABLES = ['track_search', 'track_search_keys'];
// Bump when the schema changes, so an index written by an older version is
// dropped and rebuilt by replay at the next open instead of being misread. A
// table added empty, whose absence nothing misreads, needs no bump: every
// open applies the schema. Version 2 keys labels by track id from label
// records (§2.5), so an index of envelope tags never survives.
export const SCHEMA_VERSION = 2;
// Each library's verified signed-entry blocks, so a restart reads its oplog
// in one scan (entry-blocks.ts). Empty is valid: the open walks the blockstore
// and fills it. Rows are appended in rowid order and read through
// entry_blocks_by_library, which orders a library's rows by rowid, so the scan
// reads the file forward. Keyed by hash instead, a library's rows would lie in
// hash order across the file and a cold open would read them at random.
const ENTRY_BLOCKS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS entry_blocks (
    library_address TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    bytes BLOB NOT NULL,
    UNIQUE (library_address, entry_hash)
  );
  CREATE INDEX IF NOT EXISTS entry_blocks_by_library ON entry_blocks (library_address);
`;
// Each library's summary counts, kept by triggers on every row change, so
// GET /libraries reads one row instead of scanning a library's tracks and
// entries, which on a large library and a cold disk held the event loop for
// minutes. A row change's old values leave the totals and its new ones join
// them; INSERT OR REPLACE fires no delete trigger, so no writer of these
// tables may use it.
const counted = ({ table, row, sign }) => {
    const deltas = {
        tracks: { track_count: '1', audio_size_bytes: `coalesce(${row}.audio_size_bytes, 0)` },
        entries: { put_count: `${row}.op = 'PUT'` }
    }[table];
    const columns = Object.keys(deltas);
    const values = Object.values(deltas).map((delta) => `${sign}(${delta})`);
    return `INSERT INTO library_totals (library_address, ${columns.join(', ')}) VALUES (${row}.library_address, ${values.join(', ')})
      ON CONFLICT(library_address) DO UPDATE SET ${columns.map((column) => `${column} = ${column} + excluded.${column}`).join(', ')};`;
};
// The columns a row's totals depend on, so an update of any other column,
// such as listen_count, fires no totals trigger.
const TOTALS_COLUMNS = {
    tracks: 'library_address, audio_size_bytes',
    entries: 'library_address, op'
};
const totals_triggers = (table) => `
  CREATE TRIGGER IF NOT EXISTS ${table}_totals_insert AFTER INSERT ON ${table} BEGIN
    ${counted({ table, row: 'NEW', sign: '+' })}
  END;
  CREATE TRIGGER IF NOT EXISTS ${table}_totals_delete AFTER DELETE ON ${table} BEGIN
    ${counted({ table, row: 'OLD', sign: '-' })}
  END;
  CREATE TRIGGER IF NOT EXISTS ${table}_totals_update AFTER UPDATE OF ${TOTALS_COLUMNS[table]} ON ${table} BEGIN
    ${counted({ table, row: 'OLD', sign: '-' })}
    ${counted({ table, row: 'NEW', sign: '+' })}
  END;`;
const LIBRARY_TOTALS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS library_totals (
    library_address TEXT PRIMARY KEY,
    track_count INTEGER NOT NULL DEFAULT 0,
    audio_size_bytes INTEGER NOT NULL DEFAULT 0,
    put_count INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID;
  ${['tracks', 'entries'].map(totals_triggers).join('\n')}
`;
// tracks.listen_count follows the listens table; a track row takes its count
// when inserted (projector.ts).
const LISTEN_COUNT_SCHEMA = `
  CREATE INDEX IF NOT EXISTS tracks_by_listen_count ON tracks (listen_count, track_id);
  CREATE TRIGGER IF NOT EXISTS listens_count_insert AFTER INSERT ON listens BEGIN
    UPDATE tracks SET listen_count = listen_count + 1 WHERE track_id = NEW.track_id;
  END;
  CREATE TRIGGER IF NOT EXISTS listens_count_delete AFTER DELETE ON listens BEGIN
    UPDATE tracks SET listen_count = listen_count - 1 WHERE track_id = OLD.track_id;
  END;
`;
// Track search: a trigram index over the four fields a search matches, kept
// by triggers on tracks, so a query of three or more characters reads its
// matches instead of testing every track with LIKE, which on a large index
// held the event loop for hundreds of milliseconds per keystroke. tracks has
// no rowid, so track_search_keys gives each row the one its index row takes.
const search_key = (row) => `(SELECT id FROM track_search_keys WHERE library_address = ${row}.library_address AND track_id = ${row}.track_id)`;
const TRACK_SEARCH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS track_search_keys (
    id INTEGER PRIMARY KEY,
    library_address TEXT NOT NULL,
    track_id TEXT NOT NULL,
    UNIQUE (library_address, track_id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS track_search USING fts5(title, artist, album, remixer, tokenize = 'trigram');
  CREATE TRIGGER IF NOT EXISTS tracks_search_insert AFTER INSERT ON tracks BEGIN
    INSERT INTO track_search_keys (library_address, track_id) VALUES (NEW.library_address, NEW.track_id);
    INSERT INTO track_search (rowid, title, artist, album, remixer) VALUES (${search_key('NEW')}, NEW.title, NEW.artist, NEW.album, NEW.remixer);
  END;
  CREATE TRIGGER IF NOT EXISTS tracks_search_delete AFTER DELETE ON tracks BEGIN
    DELETE FROM track_search WHERE rowid = ${search_key('OLD')};
    DELETE FROM track_search_keys WHERE library_address = OLD.library_address AND track_id = OLD.track_id;
  END;
  CREATE TRIGGER IF NOT EXISTS tracks_search_update AFTER UPDATE OF library_address, track_id, title, artist, album, remixer ON tracks BEGIN
    DELETE FROM track_search WHERE rowid = ${search_key('OLD')};
    DELETE FROM track_search_keys WHERE library_address = OLD.library_address AND track_id = OLD.track_id;
    INSERT INTO track_search_keys (library_address, track_id) VALUES (NEW.library_address, NEW.track_id);
    INSERT INTO track_search (rowid, title, artist, album, remixer) VALUES (${search_key('NEW')}, NEW.title, NEW.artist, NEW.album, NEW.remixer);
  END;
`;
const SCHEMA = `
  -- The current entry per (library, key) under §4.4.2. A current DEL stays as
  -- a row with op DEL: that is the tombstone.
  CREATE TABLE IF NOT EXISTS entries (
    library_address TEXT NOT NULL,
    key TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('PUT', 'DEL')),
    type TEXT NOT NULL CHECK (type IN ('track', 'about')),
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
    -- Every listen of the track id in any listens library, kept by the
    -- listens triggers and set at insert, so the listen_count sort reads an
    -- index instead of counting per row.
    listen_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (library_address, track_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS tracks_by_track_id ON tracks (track_id);
  -- One per GET /tracks sort but listen_count, in the order list_tracks
  -- pages it (queries.ts), so a page walks the index instead of sorting.
  CREATE INDEX IF NOT EXISTS tracks_by_title ON tracks (title COLLATE NOCASE, track_id);
  CREATE INDEX IF NOT EXISTS tracks_by_artist ON tracks (artist COLLATE NOCASE, track_id);
  CREATE INDEX IF NOT EXISTS tracks_by_album ON tracks (album COLLATE NOCASE, track_id);
  CREATE INDEX IF NOT EXISTS tracks_by_bpm ON tracks (bpm, track_id);
  CREATE INDEX IF NOT EXISTS tracks_by_duration ON tracks (duration_seconds, track_id);
  CREATE INDEX IF NOT EXISTS tracks_by_bitrate ON tracks (bitrate, track_id);
  CREATE INDEX IF NOT EXISTS tracks_by_added_at ON tracks (added_at_ms, track_id);

  -- The labels each library applies (§2.5): one row per (library, track id,
  -- label) pair whose current label record under §4.4.2 sets it, with that
  -- entry. The track id need not be held by any library, and a pair outlives
  -- the track's removal.
  CREATE TABLE IF NOT EXISTS tags (
    library_address TEXT NOT NULL,
    track_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    PRIMARY KEY (library_address, track_id, tag)
  ) WITHOUT ROWID;
  -- Label filters and counts read the label_libraries one label at a time;
  -- a page's labels and a probe of one track's read by track id.
  CREATE INDEX IF NOT EXISTS tags_by_library_tag ON tags (library_address, tag, track_id);
  CREATE INDEX IF NOT EXISTS tags_by_track_id ON tags (track_id, tag);

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

  -- Library names (§2.6): the current About record, keyed by about id.
  CREATE TABLE IF NOT EXISTS about (
    library_address TEXT NOT NULL,
    about_id TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    name TEXT,
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
${LISTEN_COUNT_SCHEMA}

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

${ENTRY_BLOCKS_SCHEMA}

  -- Per library, the heads of the oplog its cached blocks were last written
  -- from and the verification rules version that oplog was verified under, so
  -- an open restores a matching cache without verifying each entry again
  -- (entry-blocks.ts). A missing row means verify in full.
  CREATE TABLE IF NOT EXISTS entry_blocks_verified (
    library_address TEXT PRIMARY KEY,
    heads TEXT NOT NULL,
    rules_version INTEGER NOT NULL
  ) WITHOUT ROWID;

${LIBRARY_TOTALS_SCHEMA}

${TRACK_SEARCH_SCHEMA}

  -- Schema version, for §4.7 rebuilds on schema change. Not protocol.
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) WITHOUT ROWID;
`;
const STAMP_VERSION = "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
export const apply_schema = (db) => {
    in_transaction(db, () => {
        db.exec(SCHEMA);
        db.prepare(STAMP_VERSION).run(String(SCHEMA_VERSION));
    });
};
export const drop_schema = (db) => {
    for (const table of [...SEARCH_TABLES, ...QUERY_TABLES, ...ENTRY_BLOCK_TABLES])
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
    // SQLite's 2 MB default cache sends every scan of a large index back to
    // disk, and on base-storage's image a cold read of the first track page
    // took 28 s. Reads go through the mapped file, so the OS page cache serves
    // them; the cache holds the hot B-tree pages, and sorts stay in memory.
    db.exec('PRAGMA cache_size = -131072');
    db.exec('PRAGMA mmap_size = 2147483648');
    db.exec('PRAGMA temp_store = MEMORY');
    // An older or unreadable schema: drop every table and start over. The
    // next library open finds no marker and rebuilds the index by replay.
    if (stored_version(db) !== String(SCHEMA_VERSION))
        drop_schema(db);
    apply_schema(db);
    return db;
};
// A locked store is healthy and transient, not corrupt: never rebuild one it
// could not open. While a peer's batch is open it holds the write lock, and a
// reader that wants the committed state asks the peer to flush; this path only
// decides whether a store is worth destroying, and a lock never is.
const is_busy_error = (error) => typeof error === 'object' && error !== null && 'errcode' in error &&
    ((error.errcode) & 0xff) === 5;
// A file path, or ':memory:' for an index that lives as long as the process.
// A missing, corrupt, or unreadable file is removed and rebuilt: the survivor
// replays every library at its next open, so the index can never be misread.
// A locked file is neither, so it is left alone.
export const open_query_db = ({ path = ':memory:' } = {}) => {
    try {
        return open(path);
    }
    catch (error) {
        if (path === ':memory:' || is_busy_error(error))
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
