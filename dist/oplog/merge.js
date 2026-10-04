// Merging remote entries (§4.5). Merge is set union over verified entries
// plus total-order resolution per key, so it is associative and commutative.
import { compute_cid_string } from '#encoding/cid.ts';
import { decode_signed_entry } from '#entry/signed.ts';
import { ProtocolError } from '#types/errors.ts';
import { restore_entry, verify_entry } from "./accept.js";
import { insert_entry, refresh_access_state, refresh_current_state } from "./dag.js";
const caught = (run) => {
    try {
        return run();
    }
    catch (error) {
        if (error instanceof ProtocolError)
            return error;
        throw error;
    }
};
// Takes signed-entry blocks as fetched, so size and canonical-form checks
// run before decoding is trusted and before any signature work. An entry is
// verified once its next are in the oplog (§5.4.2 item 5), so the batch is
// taken in clock order: a valid entry's clock exceeds its parents' (§4.2),
// and an entry whose parent is missing or was rejected is rejected too.
export const merge_entries = ({ oplog, blocks }) => insert_blocks({ oplog, blocks, admit: verify_entry });
// The open's path for cached blocks this rules version already verified
// (accept.ts restore_entry): the same insertion without re-verifying.
export const restore_entries = ({ oplog, blocks }) => insert_blocks({ oplog, blocks, admit: restore_entry });
const insert_blocks = ({ oplog, blocks, admit }) => {
    const rejected = [];
    const decoded = [];
    for (const bytes of blocks) {
        const result = caught(() => decode_signed_entry(bytes));
        if (result instanceof ProtocolError)
            rejected.push({ hash: compute_cid_string(bytes), error: result });
        else if (!oplog.entries.has(result.hash))
            decoded.push(result);
    }
    decoded.sort((a, b) => a.entry.clock.time - b.entry.clock.time || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
    // Steps 1, 2, and 4: verify, then insert idempotently, which keeps heads
    // equal to heads(E_local ∪ E_remote). Step 3 advances no clock.
    const merged = [];
    for (const hashed of decoded) {
        if (oplog.entries.has(hashed.hash))
            continue;
        const result = caught(() => admit({ oplog, hashed }));
        if (result instanceof ProtocolError) {
            rejected.push({ hash: hashed.hash, error: result });
            continue;
        }
        insert_entry({ oplog, entry: result });
        merged.push(result);
    }
    // Step 5: re-resolve every touched key, and every key an entry made inert
    // holds, over all of its known entries.
    const access = refresh_access_state({ oplog, added: merged });
    const keys = new Set(access.keys);
    for (const { state_key } of merged)
        if (state_key !== undefined)
            keys.add(state_key);
    refresh_current_state({ oplog, keys });
    return { merged, rejected, access };
};
