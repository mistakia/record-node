// Map-backed ContentStore for tests: deterministic, instant, and offline. Pins
// are counted by the shared pin index, in an in-memory database.
import { format_cid, import_unixfs_file, parse_content_cid, verify_block } from '#fabric/block.ts';
import { create_pin_index, open_pin_db } from '#fabric/pin-index.ts';
export const create_memory_content_store = () => {
    const blocks = new Map();
    const pins = create_pin_index({
        db: open_pin_db(),
        read: async (cid) => blocks.get(format_cid(cid)),
        has: async (cid) => blocks.has(format_cid(cid))
    });
    return {
        get: async (cid) => blocks.get(format_cid(parse_content_cid(cid))),
        put: async (cid, bytes) => {
            const parsed = parse_content_cid(cid);
            verify_block({ cid: parsed, bytes });
            blocks.set(format_cid(parsed), bytes);
        },
        has: async (cid) => blocks.has(format_cid(parse_content_cid(cid))),
        pin: async (cid, { recursive = false } = {}) => { await pins.pin(parse_content_cid(cid), recursive); },
        unpin: async (cid) => { await pins.unpin(parse_content_cid(cid)); },
        is_pinned: async (cid) => pins.is_pinned(parse_content_cid(cid)),
        evict: async (cid) => {
            const parsed = parse_content_cid(cid);
            return await pins.evict(parsed, async () => { blocks.delete(format_cid(parsed)); });
        },
        import_blob: async (source) => await import_unixfs_file({
            source,
            put: async (cid, bytes) => { blocks.set(format_cid(cid), bytes); }
        })
    };
};
