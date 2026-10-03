import type { CompressedPubkeyHex } from '#types/identity.ts';
declare const key_pair_brand: unique symbol;
export type KeyPair = {
    readonly private_key: Uint8Array;
    readonly public_key: CompressedPubkeyHex;
} & {
    readonly [key_pair_brand]: true;
};
export declare const is_compressed_pubkey: (value: unknown) => value is CompressedPubkeyHex;
export declare const validate_compressed_pubkey: (value: unknown) => CompressedPubkeyHex;
export declare const compressed_pubkey_from_private: (private_key: Uint8Array) => CompressedPubkeyHex;
export declare const key_pair_from_private_key: (private_key: Uint8Array) => KeyPair;
export declare const generate_key_pair: () => KeyPair;
export {};
