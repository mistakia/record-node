// Each library's verified signed-entry blocks, kept in the index so a restart
// reads a library's oplog in one scan. Walking from the heads instead reads
// one block at a time, since each entry names its parents, which on a slow
// disk costs a library of tens of thousands of entries many minutes. Like the
// rest of the index the cache is derived (§4.7): the open checks that it
// reproduces the persisted heads and walks the blockstore when it does not.
import { in_transaction } from "./schema.js";
export const create_entry_block_cache = (db) => {
    const select = db.prepare('SELECT bytes FROM entry_blocks WHERE library_address = ?');
    const insert = db.prepare('INSERT OR IGNORE INTO entry_blocks (library_address, entry_hash, bytes) VALUES (?, ?, ?)');
    const remove = db.prepare('DELETE FROM entry_blocks WHERE library_address = ?');
    const insert_all = (library_address, entries) => {
        for (const { hash, bytes } of entries)
            insert.run(library_address, hash, bytes);
    };
    return {
        load: (library_address) => select.all(library_address).map(({ bytes }) => bytes),
        save: ({ library_address, entries }) => { in_transaction(db, () => { insert_all(library_address, entries); }); },
        replace: ({ library_address, entries }) => {
            in_transaction(db, () => {
                remove.run(library_address);
                insert_all(library_address, entries);
            });
        },
        remove: (library_address) => { remove.run(library_address); }
    };
};
