import type { KeyPair } from '#identity/key-pair.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import type { LibraryManager } from './library.ts';
export declare const LISTENS_LIBRARY_NAME = "listens";
export declare const record_listen: ({ libraries, listens_address, key_pair, track_id, address, timestamp, client_listen_id }: {
    libraries: LibraryManager;
    listens_address: string;
    key_pair: KeyPair;
    track_id: string;
    address: string;
    timestamp?: number;
    client_listen_id?: string;
}) => Promise<VerifiedEntry>;
