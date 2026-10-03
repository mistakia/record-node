// Library lifecycle (§3.5.1, §4.6): create, open, close, and unlink, plus the
// write path every entry takes on its way into an open library. The manager
// holds the per-library pin sets, so unlink can release exactly what no other
// library still holds; the store's pins themselves do not count references.
import { create_ac_chain } from '#access-control/create.ts';
import { resolve_ac_chain } from '#access-control/resolve.ts';
import { append_entry, create_oplog } from '#oplog/dag.ts';
import { merge_entries } from '#oplog/merge.ts';
import { PeerError } from '#types/peer.ts';
import { load_entry_blocks } from "./load.js";
import { chain_pins, entry_pins, pin_into } from "./pins.js";
export const create_library_manager = ({ content_store, projector, heads_store, on_entries }) => {
    const libraries = new Map();
    let indexing = Promise.resolve();
    const require_library = (library_address) => {
        const handle = libraries.get(library_address);
        if (handle === undefined)
            throw new PeerError('not_found', `library not open: ${library_address}`);
        return handle;
    };
    const pin_entries = async (handle, entries) => {
        for (const entry of entries) {
            await pin_into({ content_store, pins: handle.pins, items: await entry_pins({ content_store, entry }) });
        }
    };
    const register = async ({ library_address, entries }) => {
        const handle = require_library(library_address);
        for (const entry of entries)
            await content_store.put(entry.hash, entry.bytes);
        await pin_entries(handle, entries);
        await heads_store.save({ library_address, heads: [...handle.oplog.heads] });
        const projected = Promise.all(entries.map(async (entry) => { await projector.project_append({ oplog: handle.oplog, entry }); }));
        indexing = projected.catch(() => { });
        await projected;
        on_entries?.({ library_address, entries });
    };
    // Resolving the chain is the gate (§3.5.1): a library that fails it never
    // gets an oplog. Its objects are pinned before any entry is loaded.
    const open_library = async (library_address) => {
        const existing = libraries.get(library_address);
        if (existing !== undefined) {
            existing.open = true;
            return existing;
        }
        const chain = await resolve_ac_chain({ library_address, block_store: content_store });
        const handle = { chain, oplog: create_oplog({ chain }), pins: new Map(), open: true };
        await pin_into({ content_store, pins: handle.pins, items: chain_pins(chain) });
        const heads = (await heads_store.load()).get(library_address) ?? [];
        merge_entries({ oplog: handle.oplog, blocks: await load_entry_blocks({ heads, content_store }) });
        await pin_entries(handle, handle.oplog.entries.values());
        libraries.set(library_address, handle);
        await heads_store.save({ library_address, heads: [...handle.oplog.heads] });
        await projector.project_library({ oplog: handle.oplog });
        return handle;
    };
    return {
        create_library: async ({ name, type, write_keys }) => {
            const { address } = await create_ac_chain({ name, type, write_keys, block_store: content_store });
            return await open_library(address);
        },
        open_library,
        close_library: async (library_address) => {
            require_library(library_address).open = false;
        },
        // §4.6: release the chain, the entries, and the content this library held
        // unless another library still holds the same CID.
        unlink_library: async (library_address) => {
            const handle = require_library(library_address);
            libraries.delete(library_address);
            const held_elsewhere = new Set([...libraries.values()].flatMap(({ pins }) => [...pins.keys()]));
            for (const cid of handle.pins.keys()) {
                if (!held_elsewhere.has(cid))
                    await content_store.unpin(cid);
            }
            handle.pins.clear();
            await heads_store.save({ library_address, heads: undefined });
            await projector.remove_library({ library_address });
        },
        get: (library_address) => libraries.get(library_address),
        list: () => [...libraries.values()],
        append: async ({ library_address, payload, key_pair }) => {
            const { oplog } = require_library(library_address);
            const entry = append_entry({ oplog, payload, key_pair });
            await register({ library_address, entries: [entry] });
            return entry;
        },
        register,
        merge: async ({ library_address, blocks }) => {
            const { oplog } = require_library(library_address);
            const result = merge_entries({ oplog, blocks });
            if (result.merged.length > 0)
                await register({ library_address, entries: result.merged });
            return result;
        },
        settled: async () => { await indexing; }
    };
};
