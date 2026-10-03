import type { ResolvedAcChain } from '#access-control/resolve.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import { type ReplicationMode, type ReplicationPolicy, type SpecNode } from '#types/peer.ts';
import type { PeerContext } from './context.ts';
import { type LibraryScope } from './ownership.ts';
import type { KeepsBlobs } from './pins.ts';
import type { StoredPolicy } from './state.ts';
export interface EffectivePolicy {
    readonly mode: ReplicationMode;
    readonly filter: SpecNode | null;
}
export declare const effective_policy: (context: PeerContext, address: string, scope?: LibraryScope) => EffectivePolicy | undefined;
export declare const track_view: ({ library_address, entry, content }: {
    library_address: string;
    entry: VerifiedEntry;
    content: Record<string, unknown>;
}) => Record<string, unknown>;
export declare const keeps_blobs: (context: PeerContext) => (chain: ResolvedAcChain) => KeepsBlobs;
export declare const get_replication_policy: (context: PeerContext, address: string) => ReplicationPolicy;
export declare const validate_policy: ({ mode, filter }: {
    mode: ReplicationMode;
    filter?: unknown;
}) => StoredPolicy;
