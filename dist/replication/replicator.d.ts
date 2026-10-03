import type { ResolvedAcChain } from '#access-control/resolve.ts';
import type { PubSub } from '#fabric/pubsub.ts';
import { type VerifiedEntry } from '#oplog/accept.ts';
import type { Oplog } from '#oplog/dag.ts';
import type { ReplicationStatus } from '#types/peer.ts';
import type { Timers } from './timers.ts';
import { type Traversal } from './traversal.ts';
export type ReplicatorState = 'idle' | 'running' | 'paused' | 'unlinked';
export interface Replicator {
    readonly library_address: string;
    readonly state: () => ReplicatorState;
    start: () => Promise<void>;
    pause: () => void;
    resume: () => void;
    unlink: () => Promise<void>;
    heads_changed: () => void;
    status: () => ReplicationStatus;
    peer_ids: () => string[];
    idle: () => Promise<void>;
    readonly traversal: Traversal;
}
export interface ReplicatorOptions {
    oplog: Oplog;
    pubsub: PubSub;
    fetch_block: (cid: string, options: {
        signal: AbortSignal;
    }) => Promise<Uint8Array | undefined>;
    merge: (entries: VerifiedEntry[]) => Promise<void>;
    concurrency: number;
    timeout_ms: number;
    heads_interval_ms: number;
    timers: Timers;
    on_status?: (status: ReplicationStatus) => void;
    on_peer_join?: (peer_id: string) => void;
    on_peer_leave?: (peer_id: string) => void;
}
export declare const verify_fetched: (chain: ResolvedAcChain) => (hash: string, bytes: Uint8Array) => VerifiedEntry;
export declare const create_replicator: ({ oplog, pubsub, fetch_block, merge, concurrency, timeout_ms, heads_interval_ms, timers, on_status, on_peer_join, on_peer_leave }: ReplicatorOptions) => Replicator;
