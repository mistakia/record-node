import type { KeyPair } from '#identity/key-pair.ts';
import type { VerifiedEntry } from './accept.ts';
import { type Oplog } from './dag.ts';
export declare const append_listen: ({ oplog, track_id, address, key_pair, timestamp }: {
    oplog: Oplog;
    track_id: string;
    address: string;
    key_pair: KeyPair;
    timestamp?: number;
}) => VerifiedEntry;
