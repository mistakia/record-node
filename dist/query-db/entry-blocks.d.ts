import type { DatabaseSync } from 'node:sqlite';
export interface EntryBlockCache {
    load: (library_address: string) => Uint8Array[];
    save: (input: {
        library_address: string;
        entries: Iterable<{
            hash: string;
            bytes: Uint8Array;
        }>;
    }) => void;
    replace: (input: {
        library_address: string;
        entries: Iterable<{
            hash: string;
            bytes: Uint8Array;
        }>;
    }) => void;
    remove: (library_address: string) => void;
}
export declare const create_entry_block_cache: (db: DatabaseSync) => EntryBlockCache;
