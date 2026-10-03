import type { ResolvedAcChain } from '#access-control/resolve.ts';
import { type HashedEntry } from '#entry/signed.ts';
import type { EntryPayload } from '#types/entry.ts';
declare const verified_entry_brand: unique symbol;
export type VerifiedEntry = HashedEntry & {
    readonly operation: EntryPayload;
} & {
    readonly [verified_entry_brand]: true;
};
export declare const verify_entry: ({ hashed, chain }: {
    hashed: HashedEntry;
    chain: ResolvedAcChain;
}) => VerifiedEntry;
export {};
