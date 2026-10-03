// secp256k1 key pairs and the compressed-pubkey canonical form (§3.1, §3.3).
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ProtocolError } from '#types/errors.ts';
const COMPRESSED_PUBKEY_PATTERN = /^0[23][0-9a-f]{64}$/;
export const is_compressed_pubkey = (value) => typeof value === 'string' && COMPRESSED_PUBKEY_PATTERN.test(value);
// Rejects anything but 66 lowercase hex chars starting 02 or 03, including
// uncompressed (04) and hybrid (06, 07) encodings of the same point (§3.1).
export const validate_compressed_pubkey = (value) => {
    if (!is_compressed_pubkey(value)) {
        throw new ProtocolError('invalid_public_key', `not a compressed secp256k1 pubkey hex: ${String(value)}`);
    }
    return value;
};
export const compressed_pubkey_from_private = (private_key) => bytesToHex(secp256k1.getPublicKey(private_key, true));
// k = 1 is the published §3.4.5 test-vector key and never a real identity.
const is_test_vector_key = (private_key) => private_key.length === 32 && private_key.every((byte, index) => byte === (index === 31 ? 1 : 0));
// Recreates an identity from persisted private key bytes (§3.3).
export const key_pair_from_private_key = (private_key) => {
    if (!secp256k1.utils.isValidSecretKey(private_key)) {
        throw new ProtocolError('invalid_private_key', 'not a valid secp256k1 secret scalar');
    }
    if (is_test_vector_key(private_key)) {
        throw new ProtocolError('test_key_refused', 'the §3.4.5 test-vector key k = 1 is refused as a real identity');
    }
    return { private_key, public_key: compressed_pubkey_from_private(private_key) };
};
export const generate_key_pair = () => key_pair_from_private_key(secp256k1.utils.randomSecretKey());
