// Identity-library records (§4.8.1, §4.8.2): library, link, and pin, inline
// in a PUT or DEL with no envelope. A record of a defined type that breaks
// its shape rejects the entry; a record type this version does not define
// merges with no state effect.
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base32 } from 'multiformats/bases/base32';
import { base58btc } from 'multiformats/bases/base58';
import { CID } from 'multiformats/cid';
import { is_library_address } from '#encoding/library-address.ts';
import { sha256_hex } from '#encoding/sha256.ts';
import { ProtocolError } from '#types/errors.ts';
import { is_record } from '#types/guards.ts';
export const IDENTITY_RECORD_TYPES = ['library', 'link', 'pin'];
const ALIAS_MAX_BYTES = 128;
const RECORD_FIELDS = {
    library: { required: ['type', 'v', 'timestamp', 'address'], optional: [] },
    link: { required: ['type', 'v', 'timestamp', 'address'], optional: ['alias'] },
    pin: { required: ['type', 'v', 'timestamp', 'cid'], optional: [] }
};
const invalid = (message) => new ProtocolError('invalid_shape', message);
const is_uint = (value) => Number.isSafeInteger(value) && value >= 0;
export const is_identity_record_type = (value) => IDENTITY_RECORD_TYPES.includes(value);
// The canonical pin form: CIDv1 in base32. A CIDv0 becomes the dag-pb CIDv1
// with the same multihash, so every encoding of one CID keys one pin.
export const canonical_cid = (cid) => {
    try {
        return CID.parse(cid, cid.startsWith('z') ? base58btc : undefined).toV1().toString(base32);
    }
    catch {
        throw new ProtocolError('invalid_cid', `not a CID: ${cid}`);
    }
};
// The key column of §4.8.2: sha256 of the address, or of the canonical cid.
export const identity_record_key = (record) => sha256_hex(record.type === 'pin' ? record.cid : record.address);
const validate_record = (value) => {
    const { required, optional } = RECORD_FIELDS[value.type];
    const fields = Object.keys(value);
    if (!required.every((field) => fields.includes(field)) || fields.some((field) => !required.includes(field) && !optional.includes(field))) {
        throw invalid(`a ${value.type} record has the fields ${[...required, ...optional].join(', ')}`);
    }
    if (value.v !== 1)
        throw invalid(`a ${value.type} record has v 1`);
    if (!is_uint(value.timestamp))
        throw invalid(`a ${value.type} record timestamp is unsigned integer milliseconds`);
    if (value.type === 'pin') {
        if (typeof value.cid !== 'string' || canonical_cid(value.cid) !== value.cid)
            throw invalid('a pin cid is a CIDv1 in base32');
        return { type: 'pin', v: 1, timestamp: value.timestamp, cid: value.cid };
    }
    if (!is_library_address(value.address))
        throw invalid(`a ${value.type} record address is a library address`);
    if (value.type === 'library')
        return { type: 'library', v: 1, timestamp: value.timestamp, address: value.address };
    if (value.alias === undefined)
        return { type: 'link', v: 1, timestamp: value.timestamp, address: value.address };
    if (typeof value.alias !== 'string' || utf8ToBytes(value.alias).length > ALIAS_MAX_BYTES) {
        throw invalid(`a link alias is a string of at most ${ALIAS_MAX_BYTES} UTF-8 bytes`);
    }
    return { type: 'link', v: 1, timestamp: value.timestamp, address: value.address, alias: value.alias };
};
// The operation check for an identity library (§4.8.1, §4.8.2).
export const validate_identity_operation = (payload) => {
    if (!is_record(payload))
        throw new ProtocolError('invalid_operation', 'an operation must be a map');
    if ('capability_id' in payload)
        throw new ProtocolError('invalid_operation', 'an identity library entry never carries capability_id');
    const { op, key, value } = payload;
    if (typeof key !== 'string')
        throw new ProtocolError('invalid_operation', 'operation key must be a string');
    if (!is_record(value) || typeof value.type !== 'string')
        throw invalid('an identity library record is a map with a type');
    if (op === 'PUT') {
        if (!is_identity_record_type(value.type))
            return { op: 'PUT', key, value, opaque: true };
        const record = validate_record(value);
        if (key !== identity_record_key(record))
            throw invalid(`a ${record.type} record key is derived from its ${record.type === 'pin' ? 'cid' : 'address'}`);
        return { op: 'PUT', key, value: record };
    }
    if (op === 'DEL') {
        const fields = Object.keys(value);
        if (fields.length !== 2 || !fields.includes('timestamp'))
            throw invalid('a DEL value is exactly {type, timestamp}');
        if (!is_uint(value.timestamp))
            throw invalid('a DEL timestamp is unsigned integer milliseconds');
        if (!is_identity_record_type(value.type))
            return { op: 'DEL', key, value, opaque: true };
        return { op: 'DEL', key, value: { type: value.type, timestamp: value.timestamp } };
    }
    throw new ProtocolError('invalid_operation', `unknown operation ${String(op)}`);
};
export const build_identity_put = (record) => Object.freeze({ op: 'PUT', key: identity_record_key(record), value: record });
export const build_identity_del = ({ type, key, timestamp = Date.now() }) => Object.freeze({ op: 'DEL', key, value: { type, timestamp } });
