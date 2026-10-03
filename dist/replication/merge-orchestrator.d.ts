export interface MergeCandidate {
    readonly hash: string;
    readonly entry: {
        readonly next: readonly string[];
    };
}
export interface MergeOrchestrator<T extends MergeCandidate> {
    add: (entry: T) => void;
    pending: () => number;
    settled: () => Promise<void>;
    discard: () => void;
}
export declare const create_merge_orchestrator: <T extends MergeCandidate>({ is_landed, merge }: {
    is_landed: (hash: string) => boolean;
    merge: (entries: T[]) => Promise<void>;
}) => MergeOrchestrator<T>;
