import type { DatabaseSync } from 'node:sqlite';
export interface CachedEntryBlocks {
    readonly blocks: Uint8Array[];
    readonly verified_heads: readonly string[] | undefined;
}
export interface EntryBlockCache {
    load: (library_address: string) => CachedEntryBlocks;
    save: (input: {
        library_address: string;
        entries: Iterable<{
            hash: string;
            bytes: Uint8Array;
        }>;
        heads: Iterable<string>;
    }) => void;
    replace: (input: {
        library_address: string;
        entries: Iterable<{
            hash: string;
            bytes: Uint8Array;
        }>;
        heads: Iterable<string>;
    }) => void;
    mark_verified: (input: {
        library_address: string;
        heads: Iterable<string>;
    }) => void;
    remove: (library_address: string) => void;
}
export declare const create_entry_block_cache: (db: DatabaseSync) => EntryBlockCache;
