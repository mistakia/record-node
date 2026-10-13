// Canonical dag-cbor (RFC 8949 deterministic encoding) behind a branded type,
// so no raw Uint8Array reaches a signing, hashing, or wire path (§2.1, §3.4.2).
import { encode, decode } from '@ipld/dag-cbor';
import { ProtocolError } from '#types/errors.ts';
export const encode_canonical = (value) => encode(value);
// A plain loop: a closure per byte cost a large library's open a tenth of
// its CPU.
const bytes_equal = (a, b) => {
    if (a.length !== b.length)
        return false;
    for (let index = 0; index < a.length; index++)
        if (a[index] !== b[index])
            return false;
    return true;
};
// Readers reject non-canonical input instead of re-encoding it (§2.1): the
// input must equal the canonical encoding of what it decodes to.
export const decode_canonical = (bytes) => {
    let value;
    try {
        value = decode(bytes);
    }
    catch (error) {
        throw new ProtocolError('malformed_encoding', `dag-cbor decode failed: ${error.message}`);
    }
    if (!bytes_equal(encode(value), bytes)) {
        throw new ProtocolError('non_canonical_encoding', 'input is not canonical dag-cbor');
    }
    return { value, bytes: bytes };
};
