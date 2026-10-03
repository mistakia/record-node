import type { VerifiedEntry } from '#oplog/accept.ts';
import type { Oplog } from '#oplog/dag.ts';
import { type Capability } from '#types/peer.ts';
import { type PeerContext } from './context.ts';
export declare const describe_capability: (oplog: Oplog, entry: VerifiedEntry, now?: number) => Capability;
export declare const list_capabilities: (context: PeerContext, address: string) => Capability[];
export declare const held_capabilities: (context: PeerContext) => Capability[];
export declare const held_capability_ids: (context: PeerContext, address: string) => string[];
export declare const issue_capability: (context: PeerContext, { library_address, grantee, actions, filter, conditions, capability_id }: {
    library_address: string;
    grantee: unknown;
    actions: readonly string[];
    filter?: unknown;
    conditions?: readonly unknown[] | undefined;
    capability_id?: string | undefined;
}) => Promise<Capability>;
export declare const revoke_capability: (context: PeerContext, { library_address, revokes, capability_id }: {
    library_address: string;
    revokes: string;
    capability_id?: string | undefined;
}) => Promise<void>;
export declare const revoked_dependency: (oplog: Oplog, entry: VerifiedEntry) => string | undefined;
