// Map-backed ContentStore for tests: deterministic, instant, and offline.
import { format_cid, import_unixfs_file, parse_content_cid, verify_block, walk_blocks } from '#fabric/block.ts';
export const create_memory_content_store = () => {
    const blocks = new Map();
    // Pinned CID to whether the pin is recursive.
    const pins = new Map();
    const covered_by = async ({ cid, recursive }) => (await walk_blocks({ cid, recursive, read: async (next) => blocks.get(format_cid(next)) })).map(format_cid);
    return {
        get: async (cid) => blocks.get(format_cid(parse_content_cid(cid))),
        put: async (cid, bytes) => {
            const parsed = parse_content_cid(cid);
            verify_block({ cid: parsed, bytes });
            blocks.set(format_cid(parsed), bytes);
        },
        has: async (cid) => blocks.has(format_cid(parse_content_cid(cid))),
        pin: async (cid, { recursive = false } = {}) => {
            const parsed = parse_content_cid(cid);
            const key = format_cid(parsed);
            if (pins.get(key) === true || pins.get(key) === recursive)
                return;
            await covered_by({ cid: parsed, recursive });
            pins.set(key, recursive);
        },
        unpin: async (cid) => {
            pins.delete(format_cid(parse_content_cid(cid)));
        },
        is_pinned: async (cid) => {
            const key = format_cid(parse_content_cid(cid));
            if (pins.has(key))
                return true;
            for (const [pinned, recursive] of pins) {
                if (recursive && (await covered_by({ cid: parse_content_cid(pinned), recursive })).includes(key))
                    return true;
            }
            return false;
        },
        import_blob: async (source) => await import_unixfs_file({
            source,
            put: async (cid, bytes) => { blocks.set(format_cid(cid), bytes); }
        })
    };
};
