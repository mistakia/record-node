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
export declare const announced_entry: ({ id, payload, next, refs, v, clock, key, sig }: SignedEntry) => SignedEntry;
export interface AnnouncedLibrary {
    readonly address: string;
    readonly about?: SignedEntry | undefined;
}
export interface Announcement {
    readonly libraries: readonly AnnouncedLibrary[];
    readonly profiles: readonly SignedEntry[];
}
export declare const encode_announcement: ({ libraries, profiles, own_count, owners }: Announcement & {
    own_count?: number;
    owners?: ReadonlyMap<string, string>;
}) => Uint8Array | undefined;
export declare const decode_announcement: (data: Uint8Array) => Announcement | undefined;
