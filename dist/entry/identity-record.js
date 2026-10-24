// Identity-library records (§4.8.1, §4.8.2): library, link, pin, and
// profile, inline in a PUT or DEL with no envelope. A record of a defined
// type that breaks its shape rejects the entry; a record type this version
// does not define merges with no state effect. A profile is the exception to
// the field rule: undefined fields are dropped, and a later version of it is
// an unknown record, so the profile can grow without stalling replication.
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base32 } from 'multiformats/bases/base32';
import { base58btc } from 'multiformats/bases/base58';
import { CID } from 'multiformats/cid';
import { is_library_address } from '#encoding/library-address.ts';
import { sha256_hex } from '#encoding/sha256.ts';
import { ProtocolError } from '#types/errors.ts';
import { is_record } from '#types/guards.ts';
export const IDENTITY_RECORD_TYPES = ['library', 'link', 'pin', 'profile'];
const ALIAS_MAX_BYTES = 128;
const PROFILE_NAME_MAX_BYTES = 128;
const PROFILE_BIO_MAX_BYTES = 1024;
// The one profile key (§4.8.2).
export const PROFILE_KEY = sha256_hex('profile');
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
// The key column of §4.8.2: sha256 of the address, of the canonical cid, or
// of "profile".
export const identity_record_key = (record) => record.type === 'profile' ? PROFILE_KEY : sha256_hex(record.type === 'pin' ? record.cid : record.address);
const is_bounded_string = (value, min_bytes, max_bytes) => {
    if (typeof value !== 'string')
        return false;
    const length = utf8ToBytes(value).length;
    return length >= min_bytes && length <= max_bytes;
};
const is_canonical_cid = (value) => {
    if (typeof value !== 'string')
        return false;
    try {
        return canonical_cid(value) === value;
    }
    catch {
        return false;
    }
};
// A v 1 profile keeps the fields §4.8.2 defines and drops the rest.
const validate_profile = (value) => {
    if (!is_uint(value.timestamp))
        throw invalid('a profile record timestamp is unsigned integer milliseconds');
    const { name, bio, avatar } = value;
    if (name !== undefined && !is_bounded_string(name, 1, PROFILE_NAME_MAX_BYTES))
        throw invalid(`a profile name is 1 to ${PROFILE_NAME_MAX_BYTES} UTF-8 bytes`);
    if (bio !== undefined && !is_bounded_string(bio, 0, PROFILE_BIO_MAX_BYTES))
        throw invalid(`a profile bio is at most ${PROFILE_BIO_MAX_BYTES} UTF-8 bytes`);
    if (avatar !== undefined && !is_canonical_cid(avatar))
        throw invalid('a profile avatar is an image CID, CIDv1 in base32, never a URL');
    return {
        type: 'profile',
        v: 1,
        timestamp: value.timestamp,
        ...(name === undefined ? {} : { name }),
        ...(bio === undefined ? {} : { bio }),
        ...(avatar === undefined ? {} : { avatar })
    };
};
// A profile whose v is a later version is an unknown record (§4.8.2).
const is_later_profile = (value) => value.type === 'profile' && Number.isSafeInteger(value.v) && value.v > 1;
const validate_record = (value) => {
    if (value.type === 'profile') {
        if (value.v !== 1)
            throw invalid('a profile record has an integer v of 1 or more');
        return validate_profile(value);
    }
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
        if (!is_identity_record_type(value.type) || is_later_profile(value))
            return { op: 'PUT', key, value, opaque: true };
        const record = validate_record(value);
        if (key !== identity_record_key(record))
            throw invalid(`a ${record.type} record key is derived as §4.8.2 states`);
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
        if (value.type === 'profile')
            throw invalid('a profile is never deleted');
        return { op: 'DEL', key, value: { type: value.type, timestamp: value.timestamp } };
    }
    throw new ProtocolError('invalid_operation', `unknown operation ${String(op)}`);
};
export const build_identity_put = (record) => Object.freeze({ op: 'PUT', key: identity_record_key(record), value: record });
export const build_identity_del = ({ type, key, timestamp = Date.now() }) => Object.freeze({ op: 'DEL', key, value: { type, timestamp } });
