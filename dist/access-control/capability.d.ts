import type { HashedEntry } from '#entry/signed.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import type { Oplog } from '#oplog/dag.ts';
import type { EntryPayload } from '#types/entry.ts';
import type { ProtocolErrorCode } from '#types/errors.ts';
export declare const MAX_CHAIN_LENGTH = 8;
export type AuthorisationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly code: ProtocolErrorCode;
    readonly reason: string;
};
export declare const is_write_list_key: (oplog: Oplog, key: string) => boolean;
export declare const capability_chain: (oplog: Oplog, capability_id: string | undefined) => string[];
export declare const inert_under: (oplog: Oplog, entry: VerifiedEntry, effective: readonly VerifiedEntry[]) => boolean;
export declare const effective_revocations: (oplog: Oplog, revocations: Iterable<VerifiedEntry>) => VerifiedEntry[];
export declare const authorise_entry: ({ oplog, hashed, operation }: {
    oplog: Oplog;
    hashed: HashedEntry;
    operation: EntryPayload;
}) => AuthorisationResult;
