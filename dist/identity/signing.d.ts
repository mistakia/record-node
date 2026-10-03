import type { SignedEntry, UnsignedEntry } from '#types/entry.ts';
export declare const unsigned_fields: ({ id, payload, next, refs, v, clock }: UnsignedEntry) => UnsignedEntry;
export declare const signing_digest: (unsigned_entry: UnsignedEntry) => Uint8Array;
export declare const sign_entry: ({ unsigned_entry, private_key }: {
    unsigned_entry: UnsignedEntry;
    private_key: Uint8Array;
}) => SignedEntry;
