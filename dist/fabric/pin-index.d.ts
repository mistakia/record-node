import { DatabaseSync } from 'node:sqlite';
import type { CID } from 'multiformats/cid';
export declare const open_pin_db: (path?: string) => DatabaseSync;
export interface PinIndex {
    pin: (cid: CID, recursive: boolean) => Promise<void>;
    unpin: (cid: CID) => Promise<void>;
    is_pinned: (cid: CID) => boolean;
    evict: (cid: CID, remove: () => Promise<void>) => Promise<boolean>;
}
export declare const create_pin_index: ({ db, read, has }: {
    db: DatabaseSync;
    read: (cid: CID) => Promise<Uint8Array | undefined>;
    has: (cid: CID) => Promise<boolean>;
}) => PinIndex;
