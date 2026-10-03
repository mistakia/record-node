import { ProtocolError } from '#types/errors.ts';
import { type VerifiedEntry } from './accept.ts';
import { type Oplog } from './dag.ts';
export interface MergeResult {
    readonly merged: readonly VerifiedEntry[];
    readonly rejected: readonly ProtocolError[];
}
export declare const merge_entries: ({ oplog, blocks }: {
    oplog: Oplog;
    blocks: readonly Uint8Array[];
}) => MergeResult;
