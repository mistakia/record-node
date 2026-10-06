// Pin accounting shared by the ContentStore backends (§4.6 item 6), in one
// SQLite file beside the blocks. Each block carries the number of pins that
// cover it, and each pinned root its kind, both keyed on the multihash, so a
// block reached through CIDs of different versions or codecs counts once.
// A pin or unpin walks its blocks, then changes every count in one
// synchronous transaction: concurrent pins of different roots never wait on
// each other, and a crash never tears a count.
//
// The index is derived. Every library open pins its entries and kept blobs
// again, and the identity library's pin records are pinned at start, so an
// index that is missing, of another version, or unreadable is replaced by an
// empty one and refilled by that pass.
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { walk_blocks } from "./block.js";
const SCHEMA_VERSION = '1';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS block_pins (multihash BLOB PRIMARY KEY, refs INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS root_pins (multihash BLOB PRIMARY KEY, recursive INTEGER NOT NULL) WITHOUT ROWID;
`;
const open = (path) => {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    // A lost last transaction is repaired by the next open's pin pass.
    db.exec('PRAGMA synchronous = NORMAL');
    const version = (() => {
        try {
            return db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value;
        }
        catch {
            return undefined;
        }
    })();
    if (version !== SCHEMA_VERSION) {
        for (const table of ['meta', 'block_pins', 'root_pins'])
            db.exec(`DROP TABLE IF EXISTS ${table}`);
    }
    db.exec(SCHEMA);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
    return db;
};
// A locked store is healthy and transient, never corrupt: the peer holds the
// write lock only while a batch is open, so deleting a file it could not open
// out from under the writer is the one outcome that must not happen.
const is_busy_error = (error) => typeof error === 'object' && error !== null && 'errcode' in error &&
    ((error.errcode) & 0xff) === 5;
// A file path, or ':memory:' for an index that lives as long as the process.
export const open_pin_db = (path = ':memory:') => {
    try {
        return open(path);
    }
    catch (error) {
        if (path === ':memory:' || is_busy_error(error))
            throw error;
        for (const suffix of ['', '-wal', '-shm'])
            rmSync(`${path}${suffix}`, { force: true });
        return open(path);
    }
};
export const create_pin_index = ({ db, read, has, commit }) => {
    const select_root = db.prepare('SELECT recursive FROM root_pins WHERE multihash = ?');
    const upsert_root = db.prepare('INSERT OR REPLACE INTO root_pins (multihash, recursive) VALUES (?, ?)');
    const delete_root = db.prepare('DELETE FROM root_pins WHERE multihash = ?');
    const select_block = db.prepare('SELECT refs FROM block_pins WHERE multihash = ?');
    const reference = db.prepare('INSERT INTO block_pins (multihash, refs) VALUES (?, 1) ON CONFLICT(multihash) DO UPDATE SET refs = refs + 1');
    const dereference = db.prepare('UPDATE block_pins SET refs = refs - 1 WHERE multihash = ?');
    const drop_released = db.prepare('DELETE FROM block_pins WHERE multihash = ? AND refs <= 0');
    const key = (cid) => cid.multihash.bytes;
    const root_kind = (cid) => {
        const row = select_root.get(key(cid));
        return row === undefined ? undefined : row.recursive === 1;
    };
    const transaction = (fn) => {
        if (commit !== undefined)
            return commit.run(fn);
        db.exec('BEGIN');
        try {
            fn();
            db.exec('COMMIT');
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    };
    // Pin and unpin of one root run one at a time, so a walk always matches
    // the kind it was made for.
    const roots = new Map();
    const root_lock = async (cid, job) => {
        const id = cid.multihash.toString();
        const run = (roots.get(id) ?? Promise.resolve()).then(job);
        const settled = run.catch(() => { });
        roots.set(id, settled);
        settled.then(() => { if (roots.get(id) === settled)
            roots.delete(id); }, () => { });
        return await run;
    };
    // Pins walk side by side; an eviction waits for the walks in flight and
    // holds new ones until it is done.
    let walking = 0;
    let walks_done;
    let evicting;
    const walk_for_pin = async (job) => {
        // Checked again after every wait, in the same step that claims the gate.
        for (let current = evicting; current !== undefined; current = evicting)
            await current;
        walking += 1;
        try {
            return await job();
        }
        finally {
            walking -= 1;
            if (walking === 0)
                walks_done?.();
        }
    };
    const exclusive_of_pins = async (job) => {
        for (let current = evicting; current !== undefined; current = evicting)
            await current;
        let done = () => { };
        evicting = new Promise((resolve) => { done = resolve; });
        try {
            if (walking > 0)
                await new Promise((resolve) => { walks_done = resolve; });
            return await job();
        }
        finally {
            walks_done = undefined;
            evicting = undefined;
            done();
        }
    };
    const covered_by = async (cid, recursive) => await walk_blocks({ cid, recursive, read, has });
    return {
        pin: async (cid, recursive) => {
            await root_lock(cid, async () => {
                const kind = root_kind(cid);
                if (kind === true || (kind === false && !recursive))
                    return;
                await walk_for_pin(async () => {
                    const covered = await covered_by(cid, recursive);
                    transaction(() => {
                        // A direct pin already counts the root itself.
                        for (const block of kind === false ? covered.slice(1) : covered)
                            reference.run(key(block));
                        upsert_root.run(key(cid), recursive ? 1 : 0);
                    });
                });
            });
        },
        unpin: async (cid) => {
            await root_lock(cid, async () => {
                const kind = root_kind(cid);
                if (kind === undefined)
                    return;
                const covered = await covered_by(cid, kind);
                transaction(() => {
                    delete_root.run(key(cid));
                    for (const block of covered) {
                        dereference.run(key(block));
                        drop_released.run(key(block));
                    }
                });
            });
        },
        is_pinned: (cid) => select_block.get(key(cid)) !== undefined,
        evict: async (cid, remove) => await exclusive_of_pins(async () => {
            if (select_block.get(key(cid)) !== undefined || !(await has(cid)))
                return false;
            await remove();
            return true;
        })
    };
};
