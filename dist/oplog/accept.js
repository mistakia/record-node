// Append verification for one entry (§2.8.2, §2.8.3, §3.5.4, §4.5 step 1):
// size, shape and fan-out, operation validity for the library type, then the
// single authorisation point. Local appends and remote merges both call it.
import { verify_entry_authorisation } from '#access-control/verify.ts';
import { assert_signed_entry_size } from '#encoding/size-bounds.ts';
import { validate_operation } from '#entry/operations.ts';
import { assert_signed_entry_shape } from '#entry/signed.ts';
import { ProtocolError } from '#types/errors.ts';
export const verify_entry = ({ hashed, chain }) => {
    assert_signed_entry_size(hashed.bytes);
    assert_signed_entry_shape(hashed.entry);
    const operation = validate_operation({ payload: hashed.entry.payload, library_type: chain.type });
    const authorisation = verify_entry_authorisation({ entry: hashed.entry, write_list: chain.write_list });
    if (!authorisation.ok) {
        throw new ProtocolError(authorisation.reason, `entry ${hashed.hash} failed append verification: ${authorisation.reason}`);
    }
    return Object.freeze({ ...hashed, operation });
};
