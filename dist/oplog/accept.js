// Append verification for one entry (§2.8.2, §2.8.3, §3.5.4, §3.5.9, §4.2,
// §4.5 step 1), in two parts. check_entry is what the entry alone decides:
// size, shape and fan-out, the operation for the library type, and the
// signature. verify_entry adds what needs the entry's causal past, the clock
// and the authorisation, so it runs once the entry's next are in the oplog.
// Local appends and remote merges both pass through verify_entry; restore_entry
// is the open's path for entries this version already verified.
import { authorise_entry } from '#access-control/capability.ts';
import { assert_signed_entry_size } from '#encoding/size-bounds.ts';
import { is_envelope_operation, is_identity_operation, validate_operation } from '#entry/operations.ts';
import { assert_signed_entry_shape } from '#entry/signed.ts';
import { verify_entry_signature } from '#identity/verification.ts';
import { ProtocolError } from '#types/errors.ts';
// Bump whenever verify_entry, or anything it calls, changes what it accepts.
// The entry block cache records the version its entries were verified under
// (query-db/entry-blocks.ts), and an open restores them unverified only under
// the same version, so a bump re-verifies every cached entry once.
export const VERIFICATION_RULES_VERSION = 1;
// In a listens or identity library only the write list may sign, which the
// entry alone decides; a recordstore grantee needs the causal past.
export const check_entry = ({ hashed, chain }) => {
    assert_signed_entry_size(hashed.bytes);
    assert_signed_entry_shape(hashed.entry);
    const operation = validate_operation({ payload: hashed.entry.payload, library_type: chain.type });
    if (!verify_entry_signature({ entry: hashed.entry })) {
        throw new ProtocolError('invalid_signature', `entry ${hashed.hash} failed append verification: invalid signature`);
    }
    if (chain.type !== 'recordstore' && !chain.write_list.includes(hashed.entry.key)) {
        throw new ProtocolError('unauthorised_writer', `entry ${hashed.hash} failed append verification: ${hashed.entry.key} is not in the write list`);
    }
    return { hashed, operation };
};
// Identity records resolve per (type, key) (§4.8.2); envelope operations per key.
const state_key_of = (operation) => {
    if (is_identity_operation(operation))
        return `${operation.value.type}:${operation.key}`;
    if (is_envelope_operation(operation))
        return operation.key;
    return undefined;
};
// §4.2: clock.time is one more than the greatest time in next, or 1 with none.
const expected_clock_time = (oplog, next) => {
    let max = 0;
    for (const hash of next) {
        const parent = oplog.entries.get(hash);
        if (parent === undefined)
            return undefined;
        max = Math.max(max, parent.entry.clock.time);
    }
    return max + 1;
};
const assert_clock = (oplog, hashed) => {
    const { next, clock } = hashed.entry;
    const expected = expected_clock_time(oplog, next);
    if (expected === undefined)
        throw new ProtocolError('invalid_clock', `entry ${hashed.hash} names a next entry the oplog does not hold`);
    if (clock.time !== expected)
        throw new ProtocolError('invalid_clock', `entry ${hashed.hash} has clock.time ${clock.time}, not ${expected}`);
};
const as_verified = (hashed, operation) => Object.freeze({ ...hashed, operation, state_key: state_key_of(operation) });
export const verify_entry = ({ oplog, hashed }) => {
    const { operation } = check_entry({ hashed, chain: oplog.chain });
    assert_clock(oplog, hashed);
    const authorisation = authorise_entry({ oplog, hashed, operation });
    if (!authorisation.ok) {
        throw new ProtocolError(authorisation.code, `entry ${hashed.hash} failed append verification: ${authorisation.reason}`);
    }
    return as_verified(hashed, operation);
};
// An entry verify_entry already accepted into this oplog under the current
// VERIFICATION_RULES_VERSION, read back at open. The signature and the
// authorisation are not checked again. The operation is parsed for its state
// key, and the clock check still rejects an entry whose next are missing, so
// a cache with a gap never restores. The hash was computed from the bytes.
export const restore_entry = ({ oplog, hashed }) => {
    const operation = validate_operation({ payload: hashed.entry.payload, library_type: oplog.chain.type });
    assert_clock(oplog, hashed);
    return as_verified(hashed, operation);
};
