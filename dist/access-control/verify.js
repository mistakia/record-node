// The single authorisation point (§3.5.3, §3.5.4): the signature verifies
// under entry.key, and entry.key is in the write-list by plain string
// equality. Every accepted entry, local or remote, passes through here.
import { verify_entry_signature } from '#identity/verification.ts';
export const verify_entry_authorisation = ({ entry, write_list }) => {
    if (!verify_entry_signature({ entry }))
        return { ok: false, reason: 'invalid_signature' };
    if (!write_list.some((key) => key === entry.key))
        return { ok: false, reason: 'unauthorised_writer' };
    return { ok: true };
};
