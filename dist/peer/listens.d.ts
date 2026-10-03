import type { KeyPair } from '#identity/key-pair.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import type { LibraryManager } from './library.ts';
export declare const LISTENS_LIBRARY_NAME = "listens";
export declare const record_listen: ({ libraries, listens_address, key_pair, track_id, address, timestamp }: {
    libraries: LibraryManager;
    listens_address: string;
    key_pair: KeyPair;
    track_id: string;
    address: string;
    timestamp?: number;
}) => Promise<VerifiedEntry>;
