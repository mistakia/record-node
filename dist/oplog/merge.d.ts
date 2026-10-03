import { ProtocolError } from '#types/errors.ts';
import { type VerifiedEntry } from './accept.ts';
import { type AccessChange, type Oplog } from './dag.ts';
export interface MergeResult {
    readonly merged: readonly VerifiedEntry[];
    readonly rejected: ReadonlyArray<{
        readonly hash: string;
        readonly error: ProtocolError;
    }>;
    readonly access: AccessChange;
}
export declare const merge_entries: ({ oplog, blocks }: {
    oplog: Oplog;
    blocks: readonly Uint8Array[];
}) => MergeResult;
