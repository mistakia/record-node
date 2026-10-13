import { DatabaseSync } from 'node:sqlite';
import type { CID } from 'multiformats/cid';
import type { CommitBatcher } from './commit-batch.ts';
export declare const open_pin_db: (path?: string) => DatabaseSync;
export interface PinIndex {
    pin: (cid: CID, recursive: boolean) => Promise<void>;
    unpin: (cid: CID) => Promise<void>;
    is_pinned: (cid: CID) => boolean;
    evict: (cid: CID, remove: () => Promise<void>) => Promise<boolean>;
}
export declare const create_pin_index: ({ db, read, has, commit }: {
    db: DatabaseSync;
    read: (cid: CID) => Promise<Uint8Array | undefined>;
    has: (cid: CID) => Promise<boolean>;
    commit?: CommitBatcher | undefined;
}) => PinIndex;
export interface LibraryPinRecord {
    load: (library_address: string) => Map<string, boolean> | undefined;
    begin: (library_address: string) => void;
    set: (library_address: string, pins: ReadonlyArray<readonly [string, boolean]>) => void;
    delete: (library_address: string, cids: readonly string[]) => void;
    settle: (library_address: string) => void;
    clear: (library_address: string) => void;
}
export declare const create_library_pin_record: ({ db, commit }: {
    db: DatabaseSync;
    commit?: CommitBatcher | undefined;
}) => LibraryPinRecord;
