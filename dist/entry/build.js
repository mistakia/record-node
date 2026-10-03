// Unsigned entry construction and the field checks shared with decoding
// (§3.4.1, §4.1.1, §5.4.2).
import { is_protocol_cid } from '#encoding/cid.ts';
import { is_compressed_pubkey } from '#identity/key-pair.ts';
import { ProtocolError } from '#types/errors.ts';
import { is_record } from '#types/guards.ts';
// Fan-out cap: next and refs each hold at most 256 hashes (§5.4.2).
export const MAX_ENTRY_POINTERS = 256;
const SIGNED_FIELDS_ONLY = ['hash', 'key', 'sig'];
const invalid = (message) => new ProtocolError('invalid_shape', message);
const assert_pointers = (value, label) => {
    if (!Array.isArray(value))
        throw invalid(`${label} must be an array`);
    if (value.length > MAX_ENTRY_POINTERS) {
        throw new ProtocolError('size_exceeded', `${label} holds ${value.length} hashes, over the ${MAX_ENTRY_POINTERS} fan-out cap`);
    }
    // Each element is the parent's entry.hash as a plain string, not a link (§4.1.1).
    if (!value.every(is_protocol_cid))
        throw invalid(`${label} elements must be base58btc entry hashes`);
    return value;
};
const assert_clock = (value) => {
    if (!is_record(value) || Object.keys(value).length !== 2)
        throw invalid('clock must be {id, time}');
    if (!is_compressed_pubkey(value.id))
        throw invalid('clock.id must be a compressed pubkey hex');
    if (!Number.isSafeInteger(value.time) || value.time < 0)
        throw invalid('clock.time must be an unsigned integer');
    return { id: value.id, time: value.time };
};
// Validates the six signed fields of a decoded or caller-supplied entry.
export const assert_unsigned_fields = (value) => {
    if (typeof value.id !== 'string')
        throw invalid('entry id must be a string');
    if (!('payload' in value))
        throw invalid('entry payload is missing');
    if (value.v !== 2)
        throw invalid('entry v must be 2');
    return {
        id: value.id,
        payload: value.payload,
        next: assert_pointers(value.next, 'next'),
        refs: assert_pointers(value.refs, 'refs'),
        v: 2,
        clock: assert_clock(value.clock)
    };
};
export const build_unsigned_entry = (input) => {
    for (const field of SIGNED_FIELDS_ONLY) {
        if (Object.hasOwn(input, field))
            throw invalid(`an unsigned entry must not carry ${field}`);
    }
    const entry = assert_unsigned_fields({ ...input, v: 2 });
    return Object.freeze({ ...entry, next: [...entry.next], refs: [...entry.refs] });
};
