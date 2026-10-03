import type { ResolvedAcChain } from '#access-control/resolve.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import { type VerifiedEntry } from './accept.ts';
export declare const MAX_CITED_HEADS = 256;
export interface Oplog {
    readonly chain: ResolvedAcChain;
    readonly entries: Map<string, VerifiedEntry>;
    readonly heads: Set<string>;
    readonly referenced: Set<string>;
    readonly key_entries: Map<string, Set<string>>;
    readonly current: Map<string, VerifiedEntry>;
    readonly capabilities: Map<string, VerifiedEntry>;
    readonly revocations: Map<string, VerifiedEntry>;
    readonly delegated: Set<string>;
    readonly effective: Set<string>;
    readonly inert: Set<string>;
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
export interface AccessChange {
    readonly inert: readonly VerifiedEntry[];
    readonly keys: ReadonlySet<string>;
}
export declare const refresh_access_state: ({ oplog, added }: {
    oplog: Oplog;
    added: readonly VerifiedEntry[];
}) => AccessChange;
export declare const get_live_entry: ({ oplog, key }: {
    oplog: Oplog;
    key: string;
}) => VerifiedEntry | undefined;
export declare const append_entry_with_access: ({ oplog, payload, key_pair }: {
    oplog: Oplog;
    payload: unknown;
    key_pair: KeyPair;
}) => {
    entry: VerifiedEntry;
    access: AccessChange;
};
export declare const append_entry: (input: {
    oplog: Oplog;
    payload: unknown;
    key_pair: KeyPair;
}) => VerifiedEntry;
