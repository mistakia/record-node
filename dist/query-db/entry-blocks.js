// Each library's verified signed-entry blocks, kept in the index so a restart
// reads a library's oplog in one scan. Walking from the heads instead reads
// one block at a time, since each entry names its parents, which on a slow
// disk costs a library of tens of thousands of entries many minutes. Like the
// rest of the index the cache is derived (§4.7): the open checks that it
// reproduces the persisted heads and walks the blockstore when it does not.
//
// Every write also records, in the same transaction, the heads of the
// in-memory oplog and the VERIFICATION_RULES_VERSION it was verified under.
// The oplog holds only verified entries, so every entry those heads reach was
// verified under that version. They can name an entry another write has not
// cached yet, but then the cache cannot reproduce them. A cache that does
// reproduce them, with no gap, is that ancestor set exactly, since each block's
// hash comes from its bytes, so the open restores it without verifying each
// entry again. Any other cache is verified in full. Only blocks of entries
// already in the oplog may be written here, or the record would vouch for
// entries that never verified.
import { VERIFICATION_RULES_VERSION } from '#oplog/accept.ts';
import { in_transaction } from "./schema.js";
export const create_entry_block_cache = (db) => {
    // Through the library index in rowid order, so the scan reads forward
    // through the file (schema.ts).
    const select = db.prepare('SELECT bytes FROM entry_blocks INDEXED BY entry_blocks_by_library WHERE library_address = ? ORDER BY rowid');
    const insert = db.prepare('INSERT OR IGNORE INTO entry_blocks (library_address, entry_hash, bytes) VALUES (?, ?, ?)');
    const remove = db.prepare('DELETE FROM entry_blocks WHERE library_address = ?');
    const select_verified = db.prepare('SELECT heads, rules_version FROM entry_blocks_verified WHERE library_address = ?');
    const upsert_verified = db.prepare(`INSERT INTO entry_blocks_verified (library_address, heads, rules_version) VALUES (?, ?, ?)
    ON CONFLICT(library_address) DO UPDATE SET heads = excluded.heads, rules_version = excluded.rules_version`);
    const remove_verified = db.prepare('DELETE FROM entry_blocks_verified WHERE library_address = ?');
    const insert_all = (library_address, entries) => {
        for (const { hash, bytes } of entries)
            insert.run(library_address, hash, bytes);
    };
    const record_verified = (library_address, heads) => {
        upsert_verified.run(library_address, JSON.stringify([...heads].sort()), VERIFICATION_RULES_VERSION);
    };
    return {
        load: (library_address) => {
            const blocks = select.all(library_address).map(({ bytes }) => bytes);
            const verified = select_verified.get(library_address);
            const current = verified !== undefined && verified.rules_version === VERIFICATION_RULES_VERSION;
            return { blocks, verified_heads: current ? JSON.parse(verified.heads) : undefined };
        },
        save: ({ library_address, entries, heads }) => {
            in_transaction(db, () => {
                insert_all(library_address, entries);
                record_verified(library_address, heads);
            });
        },
        replace: ({ library_address, entries, heads }) => {
            in_transaction(db, () => {
                remove.run(library_address);
                insert_all(library_address, entries);
                record_verified(library_address, heads);
            });
        },
        mark_verified: ({ library_address, heads }) => { record_verified(library_address, heads); },
        remove: (library_address) => {
            in_transaction(db, () => {
                remove.run(library_address);
                remove_verified.run(library_address);
            });
        }
    };
};
