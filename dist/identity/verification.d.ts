import type { SignedEntry } from '#types/entry.ts';
export declare const signature_backend: 'openssl' | 'noble';
export declare const verify_entry_signature: ({ entry }: {
    entry: SignedEntry;
}) => boolean;
