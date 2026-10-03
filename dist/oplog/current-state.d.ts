import type { HashedEntry } from '#entry/signed.ts';
export declare const compare_bytes: (a: Uint8Array, b: Uint8Array) => number;
export declare const envelope_timestamp: ({ entry }: HashedEntry) => number;
export declare const compare_current_state: (a: HashedEntry, b: HashedEntry) => number;
export declare const resolve_current_state: <T extends HashedEntry>(entries: Iterable<T>) => T | undefined;
