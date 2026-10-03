// The node identity (§3.1-§3.3): one secp256k1 key pair, persisted as hex in
// a 0600 file, and its libp2p forms for the HTTP API's identity endpoints.
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58btc } from 'multiformats/bases/base58';
import { identity } from 'multiformats/hashes/identity';
import { sha256_hex } from '#encoding/sha256.ts';
import { generate_key_pair, key_pair_from_private_key } from '#identity/key-pair.ts';
import { ProtocolError } from '#types/errors.ts';
// libp2p crypto.proto: { Type: Secp256k1 (2), Data: <key bytes> }.
const SECP256K1_KEY_TYPE = 2;
const marshal_key = (data) => Uint8Array.from([0x08, SECP256K1_KEY_TYPE, 0x12, data.length, ...data]);
const public_key_bytes = (key_pair) => hexToBytes(key_pair.public_key);
export const marshal_private_key = (key_pair) => bytesToHex(marshal_key(key_pair.private_key));
export const marshal_public_key = (key_pair) => bytesToHex(marshal_key(public_key_bytes(key_pair)));
// Accepts the libp2p marshaled secp256k1 private key in hex.
export const unmarshal_private_key = (hex) => {
    let bytes;
    try {
        bytes = hexToBytes(hex);
    }
    catch {
        throw new ProtocolError('invalid_private_key', 'private_key must be hex');
    }
    if (bytes.length !== 36 || bytes[0] !== 0x08 || bytes[1] !== SECP256K1_KEY_TYPE || bytes[2] !== 0x12 || bytes[3] !== 32) {
        throw new ProtocolError('invalid_private_key', 'private_key must be a libp2p marshaled secp256k1 key');
    }
    return key_pair_from_private_key(bytes.slice(4));
};
// The libp2p peer id: an identity multihash of the marshaled public key, in
// base58btc without the multibase prefix.
export const peer_id_of = (key_pair) => base58btc.baseEncode(identity.digest(marshal_key(public_key_bytes(key_pair))).bytes);
// The id the identity import endpoint reports: sha256 of the public key hex.
export const identity_id_of = (key_pair) => sha256_hex(key_pair.public_key);
// Written to a temp file and renamed, so a crash never leaves half a key.
export const save_key_pair = async ({ path, key_pair }) => {
    await mkdir(dirname(path), { recursive: true });
    const temp_path = `${path}.tmp`;
    await writeFile(temp_path, `${bytesToHex(key_pair.private_key)}\n`, { mode: 0o600 });
    await chmod(temp_path, 0o600);
    await rename(temp_path, path);
};
// Loads the persisted key, or generates and persists one on first start.
export const load_key_pair = async ({ path }) => {
    if (path === undefined)
        return generate_key_pair();
    let hex;
    try {
        hex = (await readFile(path, 'utf8')).trim();
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    if (hex !== undefined)
        return key_pair_from_private_key(hexToBytes(hex));
    const key_pair = generate_key_pair();
    await save_key_pair({ path, key_pair });
    return key_pair;
};
