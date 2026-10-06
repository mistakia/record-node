// ContentStore over a Helia node (§5.5.1): its blockstore for blocks, and the
// shared pin index for retention. Every read passes offline, so a networked
// node behaves the same as an offline one here.
//
// Helia's own pins are not used. Its recursive pins mishandle a block shared
// by two roots in helia 7.1.15-7.1.16, and its pin records are two datastore
// files per block, which on a large library on a slow disk made every pin a
// handful of cold directory lookups.
//
// Eviction deletes from the raw blockstore Helia wraps: Helia's own delete
// first cancels reproviding, which throws on a node with no content router.
import { collect_bytes, import_unixfs_file, parse_content_cid as parse_cid, verify_block } from '#fabric/block.ts';
import { create_pin_index } from '#fabric/pin-index.ts';
const as_helia_cid = (cid) => cid;
const parse_content_cid = (cid_string) => as_helia_cid(parse_cid(cid_string));
const OFFLINE = { offline: true };
const is_named_error = (error, name) => error instanceof Error && error.name === name;
export const create_helia_content_store = ({ helia, blockstore, pin_db, commit }) => {
    const read_block = async (cid) => {
        try {
            return await collect_bytes(helia.blockstore.get(cid, OFFLINE));
        }
        catch (error) {
            if (is_named_error(error, 'BlockNotFoundWhileOfflineError'))
                return undefined;
            throw error;
        }
    };
    const pins = create_pin_index({
        db: pin_db,
        read: async (cid) => await read_block(as_helia_cid(cid)),
        has: async (cid) => await blockstore.has(cid),
        commit
    });
    return {
        get: async (cid) => await read_block(parse_content_cid(cid)),
        put: async (cid, bytes) => {
            const parsed = parse_cid(cid);
            verify_block({ cid: parsed, bytes });
            await helia.blockstore.put(as_helia_cid(parsed), bytes);
        },
        has: async (cid) => await helia.blockstore.has(parse_content_cid(cid)),
        pin: async (cid, { recursive = false } = {}) => { await pins.pin(parse_cid(cid), recursive); },
        unpin: async (cid) => { await pins.unpin(parse_cid(cid)); },
        is_pinned: async (cid) => pins.is_pinned(parse_cid(cid)),
        evict: async (cid) => {
            const parsed = parse_cid(cid);
            return await pins.evict(parsed, async () => { await blockstore.delete(parsed); });
        },
        import_blob: async (source) => await import_unixfs_file({
            source,
            put: async (cid, bytes) => { await helia.blockstore.put(cid, bytes); }
        })
    };
};
