// Identity types (§3.1, §3.2).

declare const compressed_pubkey_brand: unique symbol

// 66-char lowercase hex of a compressed SEC1 secp256k1 point, prefix 02 or 03.
// Constructible only through validate_compressed_pubkey or key derivation.
export type CompressedPubkeyHex = string & { readonly [compressed_pubkey_brand]: true }

// The node id is the compressed pubkey hex itself (§3.2).
export type NodeId = CompressedPubkeyHex
