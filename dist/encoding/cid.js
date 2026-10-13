// Protocol-object CIDs: dag-cbor, sha3-512, CIDv1, base58btc (§2.1, §4.1.2).
import { code as DAG_CBOR_CODE } from '@ipld/dag-cbor';
import { decode_base58btc, encode_base58btc } from '#encoding/base58.ts';
import { sha3_512 } from '#encoding/sha3.ts';
import { base58btc } from 'multiformats/bases/base58';
import { CID } from 'multiformats/cid';
import { create as create_digest } from 'multiformats/hashes/digest';
import { ProtocolError } from '#types/errors.ts';
export const SHA3_512_CODE = 0x14;
const SHA3_512_LENGTH = 64;
export const compute_cid = (bytes) => CID.createV1(DAG_CBOR_CODE, create_digest(SHA3_512_CODE, sha3_512(bytes)));
// A protocol-object CID's base58btc string, through the fast codec.
export const format_protocol_cid = (cid) => `z${encode_base58btc(cid.bytes)}`;
// The string written into envelope.content, next, refs, and entry.hash.
export const compute_cid_string = (bytes) => format_protocol_cid(compute_cid(bytes));
// Parse a protocol-object CID string, requiring the exact §2.1 profile and
// its canonical base58btc spelling.
export const parse_cid = (cid_string) => {
    let cid;
    try {
        cid = CID.parse(cid_string, base58btc);
    }
    catch {
        throw new ProtocolError('invalid_cid', `not a base58btc CID: ${cid_string}`);
    }
    const matches_profile = cid.version === 1 &&
        cid.code === DAG_CBOR_CODE &&
        cid.multihash.code === SHA3_512_CODE &&
        cid.multihash.size === SHA3_512_LENGTH &&
        cid.toString(base58btc) === cid_string;
    if (!matches_profile) {
        throw new ProtocolError('invalid_cid', `not a dag-cbor sha3-512 CIDv1: ${cid_string}`);
    }
    return cid;
};
// The bytes every protocol-object CID starts with: CIDv1, dag-cbor, sha3-512,
// 64-byte digest.
const PROTOCOL_CID_PREFIX = [0x01, DAG_CBOR_CODE, SHA3_512_CODE, SHA3_512_LENGTH];
// Whether parse_cid accepts the string, decided on its bytes alone. Base58
// spells each byte string one way, and a leading '1' decodes to a zero byte
// the prefix refuses, so no separate round-trip check is needed.
export const is_protocol_cid = (value) => {
    if (typeof value !== 'string' || !value.startsWith('z'))
        return false;
    const bytes = decode_base58btc(value.slice(1));
    return bytes !== undefined && bytes.length === PROTOCOL_CID_PREFIX.length + SHA3_512_LENGTH &&
        PROTOCOL_CID_PREFIX.every((byte, index) => bytes[index] === byte);
};
// Audio, artwork, and avatar CIDs follow the content network's import
// profile (§2.1, §6.2.4), so any codec and hash is accepted, but always as a
// base58btc string in an entry, never as a dag-cbor link (v1.0.4).
export const is_cid_string = (value) => {
    if (typeof value !== 'string')
        return false;
    try {
        CID.parse(value, base58btc);
        return true;
    }
    catch {
        return false;
    }
};
