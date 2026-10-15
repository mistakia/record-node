import type { DatabaseSync } from 'node:sqlite';
export interface WalCheckpointPolicy {
    interval_ms: number;
    truncate_bytes: number;
    drain_timeout_ms: number;
}
export declare const DEFAULT_WAL_CHECKPOINT_POLICY: WalCheckpointPolicy;
export interface WalCheckpointer {
    nudge: () => void;
    over_bound: () => boolean;
    drain: () => Promise<void>;
    stop: () => Promise<void>;
}
export declare const start_wal_checkpointer: ({ db, path, policy }: {
    db: DatabaseSync;
    path: string;
    policy?: WalCheckpointPolicy;
}) => WalCheckpointer;
