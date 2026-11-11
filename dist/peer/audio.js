// Audio blobs for playback. HEAD reports local availability only, checking
// leaves without reading them; GET opens the file and streams the range it
// asks for, reading only the blocks that cover it, and on a networked peer
// fetches what is missing from peers within one request's peer-wait budget
// (chapter 7 /audio, chapter 8 §8.6.5a). Streaming never pins: the blocks it
// fetched sit in a byte-capped cache, trimmed after each fetch, and are
// evicted least recently used first, unless a pin has since covered them.
//
// @helia/bitswap 4.0.19 never sends the cancel that follows a received block,
// so the sending peer keeps the want as served and ignores a later want for
// the same block over that connection: an evicted block fetches again only
// from another peer or after the connection cycles.
import { has_unixfs_file, open_unixfs_file, read_unixfs_file } from '#fabric/unixfs.ts';
import { ProtocolError } from '#types/errors.ts';
import { create_peer_wait_budget } from "./peer-wait-budget.js";
// A missing or non-file blob reads as absent; an invalid CID still throws.
const absent_when_unreadable = async (lookup, absent) => {
    try {
        return await lookup;
    }
    catch (error) {
        if (error instanceof ProtocolError && (error.code === 'invalid_shape' || error.code === 'content_unavailable'))
            return absent;
        throw error;
    }
};
export const create_audio_source = ({ content_store, network, timeout_ms, max_bytes }) => {
    // Fetched block CID to its size, oldest use first.
    const cached = new Map();
    let total = 0;
    const touch = (cid) => {
        const size = cached.get(cid);
        if (size === undefined)
            return;
        cached.delete(cid);
        cached.set(cid, size);
    };
    const remember = (cid, size) => {
        if (cached.has(cid))
            return touch(cid);
        cached.set(cid, size);
        total += size;
    };
    // A tracked block a pin now covers leaves the cache but stays stored.
    const trim = async () => {
        for (const [cid, size] of cached) {
            if (total <= max_bytes)
                return;
            cached.delete(cid);
            total -= size;
            await content_store.evict(cid);
        }
    };
    return {
        open: async (cid, { closed } = {}) => {
            if (network === undefined)
                return await absent_when_unreadable(open_unixfs_file({ cid, read: content_store.get }), undefined);
            const fetch_within_budget = create_peer_wait_budget({ network, timeout_ms, closed });
            return await absent_when_unreadable(open_unixfs_file({
                cid,
                read: async (block) => {
                    const local = await content_store.get(block);
                    if (local !== undefined) {
                        touch(block);
                        return local;
                    }
                    const fetched = await fetch_within_budget(block);
                    if (fetched !== undefined) {
                        remember(block, fetched.length);
                        await trim();
                    }
                    return fetched;
                }
            }), undefined);
        },
        has_local: async (cid) => await absent_when_unreadable(has_unixfs_file({ cid, read: content_store.get, has: content_store.has }), false),
        read_local: async (cid) => await absent_when_unreadable(read_unixfs_file({ cid, read: content_store.get }), undefined),
        cached_bytes: () => total
    };
};
