declare const compressed_pubkey_brand: unique symbol;
export type CompressedPubkeyHex = string & {
    readonly [compressed_pubkey_brand]: true;
};
export type NodeId = CompressedPubkeyHex;
export {};
