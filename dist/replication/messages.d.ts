import type { SignedEntry } from '#types/entry.ts';
export declare const NETWORK_MESSAGE_MAX_BYTES: number;
export declare const encode_heads_message: ({ heads, incomplete }: {
    heads: readonly string[];
    incomplete?: boolean;
}) => string;
export declare const encode_heads_batches: ({ heads, max_bytes }: {
    heads: readonly string[];
    max_bytes?: number;
}) => Uint8Array[];
export interface HeadsMessage {
    readonly heads: readonly string[];
    readonly incomplete: boolean;
}
export declare const decode_heads_message: (data: Uint8Array) => HeadsMessage | undefined;
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
export type LoadedAboutEntry = ReturnType<typeof build_loaded_about_entry>;
export declare const encode_announcement: ({ about, logs }: {
    about: LoadedAboutEntry;
    logs: readonly LoadedAboutEntry[];
}) => Uint8Array | undefined;
export interface AnnouncedLibrary {
    readonly address: string;
    readonly hint: LoadedAboutEntry;
}
export declare const decode_announcement: (data: Uint8Array) => {
    about: AnnouncedLibrary;
    logs: AnnouncedLibrary[];
} | undefined;
