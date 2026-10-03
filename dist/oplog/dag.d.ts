import type { ResolvedAcChain } from '#access-control/resolve.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import { type VerifiedEntry } from './accept.ts';
export interface Oplog {
    readonly chain: ResolvedAcChain;
    readonly entries: Map<string, VerifiedEntry>;
    readonly heads: Set<string>;
    readonly referenced: Set<string>;
    readonly key_entries: Map<string, Set<string>>;
    readonly current: Map<string, VerifiedEntry>;
    clock_time: number;
}
export declare const create_oplog: ({ chain }: {
    chain: ResolvedAcChain;
}) => Oplog;
export declare const insert_entry: ({ oplog, entry }: {
    oplog: Oplog;
    entry: VerifiedEntry;
}) => boolean;
export declare const refresh_current_state: ({ oplog, keys }: {
    oplog: Oplog;
    keys: Iterable<string>;
}) => void;
export declare const get_live_entry: ({ oplog, key }: {
    oplog: Oplog;
    key: string;
}) => VerifiedEntry | undefined;
export declare const append_entry: ({ oplog, payload, key_pair }: {
    oplog: Oplog;
    payload: unknown;
    key_pair: KeyPair;
}) => VerifiedEntry;
