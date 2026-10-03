import type { HashedEntry } from '#entry/signed.ts';
export declare const in_causal_past: ({ entries, ancestor, next }: {
    entries: ReadonlyMap<string, HashedEntry>;
    ancestor: string;
    next: readonly string[];
}) => boolean;
