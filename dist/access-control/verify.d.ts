import type { SignedEntry } from '#types/entry.ts';
import type { CompressedPubkeyHex } from '#types/identity.ts';
export type AuthorisationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: 'invalid_signature' | 'unauthorised_writer';
};
export declare const verify_entry_authorisation: ({ entry, write_list }: {
    entry: SignedEntry;
    write_list: readonly CompressedPubkeyHex[];
}) => AuthorisationResult;
