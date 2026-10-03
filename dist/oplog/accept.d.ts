import type { ResolvedAcChain } from '#access-control/resolve.ts';
import { type HashedEntry } from '#entry/signed.ts';
import type { EntryPayload } from '#types/entry.ts';
import type { Oplog } from './dag.ts';
declare const verified_entry_brand: unique symbol;
export type VerifiedEntry = HashedEntry & {
    readonly operation: EntryPayload;
    readonly state_key: string | undefined;
} & {
    readonly [verified_entry_brand]: true;
};
export interface CheckedEntry {
    readonly hashed: HashedEntry;
    readonly operation: EntryPayload;
}
export declare const check_entry: ({ hashed, chain }: {
    hashed: HashedEntry;
    chain: ResolvedAcChain;
}) => CheckedEntry;
export declare const verify_entry: ({ oplog, hashed }: {
    oplog: Oplog;
    hashed: HashedEntry;
}) => VerifiedEntry;
export {};
