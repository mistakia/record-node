// Reading a library's oplog back out of the local content store: walk from
// the persisted heads along next and refs, collecting each entry block once.
// Verification is the merge's job; a block missing locally is skipped, and
// the replication stage fetches it.
import { decode_signed_entry } from '#entry/signed.ts';
import { ProtocolError } from '#types/errors.ts';
export const load_entry_blocks = async ({ heads, content_store }) => {
    const seen = new Set();
    const blocks = [];
    const queue = [...heads];
    for (let hash = queue.shift(); hash !== undefined; hash = queue.shift()) {
        if (seen.has(hash))
            continue;
        seen.add(hash);
        let bytes;
        try {
            bytes = await content_store.get(hash);
        }
        catch (error) {
            if (error instanceof ProtocolError)
                continue;
            throw error;
        }
        if (bytes === undefined)
            continue;
        blocks.push(bytes);
        try {
            const { entry } = decode_signed_entry(bytes);
            queue.push(...entry.next, ...entry.refs);
        }
        catch (error) {
            if (!(error instanceof ProtocolError))
                throw error;
        }
    }
    return blocks;
};
