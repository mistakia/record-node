import { type CanonicalBytes } from '#encoding/canonical-bytes.ts';
import type { SignedEntry } from '#types/entry.ts';
export interface HashedEntry {
    readonly hash: string;
    readonly multihash: Uint8Array;
    readonly bytes: CanonicalBytes;
    readonly entry: SignedEntry;
}
export declare const assert_signed_entry_shape: (value: unknown) => SignedEntry;
export declare const hash_signed_entry: (entry: SignedEntry) => HashedEntry;
export declare const decode_signed_entry: (bytes: Uint8Array) => HashedEntry;
