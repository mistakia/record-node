import type { DatabaseSync } from 'node:sqlite';
export interface CommitPolicy {
    window_ms: number;
    max_transactions: number;
}
export declare const DEFAULT_COMMIT_POLICY: CommitPolicy;
export interface CommitBatcher {
    run: (fn: () => void) => void;
    flush: () => void;
    close: () => void;
}
export declare const create_commit_batcher: (db: DatabaseSync, policy: CommitPolicy) => CommitBatcher;
