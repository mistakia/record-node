import { ProtocolError } from '#types/errors.ts';
import type { Timers } from './timers.ts';
export interface TraversedEntry {
    readonly hash: string;
    readonly entry: {
        readonly next: readonly string[];
        readonly refs: readonly string[];
    };
}
export interface Traversal {
    enqueue: (hashes: Iterable<string>) => void;
    pause: () => void;
    resume: () => void;
    discard: () => void;
    idle: () => Promise<void>;
    readonly enqueued: ReadonlySet<string>;
    readonly unresolved: () => string[];
    readonly rejected: ReadonlyMap<string, ProtocolError>;
    readonly outstanding: () => number;
}
export declare const create_traversal: <T extends TraversedEntry>({ fetch, verify, is_landed, on_entry, on_change, concurrency, timeout_ms, timers }: {
    fetch: (hash: string, options: {
        signal: AbortSignal;
    }) => Promise<Uint8Array | undefined>;
    verify: (hash: string, bytes: Uint8Array) => T;
    is_landed: (hash: string) => boolean;
    on_entry: (entry: T) => void;
    on_change?: () => void;
    concurrency: number;
    timeout_ms: number;
    timers: Timers;
}) => Traversal;
