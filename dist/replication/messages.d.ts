import type { SignedEntry } from '#types/entry.ts';
export declare const encode_heads_message: ({ heads }: {
    heads: readonly string[];
}) => string;
export declare const build_loaded_about_entry: ({ hash, entry, about_content }: {
    hash: string;
    entry: SignedEntry;
    about_content: Record<string, unknown>;
}) => {
    hash: string;
    id: string;
    payload: {
        op: string;
        key: string;
        value: {
            id: string;
            timestamp: number;
            v: number;
            type: string;
            content: Record<string, unknown>;
        };
    };
    next: readonly string[];
    refs: readonly string[];
    v: 2;
    clock: import("#types/entry.ts").LamportClock;
    key: import("../types/identity.ts").CompressedPubkeyHex;
    sig: string;
};
