// Library lifecycle (§3.5.1, §4.6): create, open, close, and unlink, plus the
// write path every entry takes on its way into an open library. The manager
// holds the per-library pin sets, so unlink can release exactly what no other
// library still holds; the store's pins themselves do not count references.
import { create_ac_chain } from '#access-control/create.ts';
import { resolve_ac_chain } from '#access-control/resolve.ts';
import { append_entry_with_access, create_oplog } from '#oplog/dag.ts';
import { merge_entries, restore_entries } from '#oplog/merge.ts';
import { PeerError } from '#types/peer.ts';
import { run_bounded } from "./bounded.js";
import { load_entry_blocks } from "./load.js";
import { canonical_cid } from '#entry/identity-record.ts';
import { chain_pins, entry_pins, pin_into, stored_item_6 } from "./pins.js";
// Pins compare by CID, whatever the encoding: an entry's base58btc
// content.hash and a pin record's base32 CIDv1 name one blob.
const canonical_or_self = (cid) => {
    try {
        return canonical_cid(cid);
    }
    catch {
        return cid;
    }
};
// Entries pinned at once. Each pin is a few small reads, which a slow disk
// serves far faster side by side than one after another.
const PIN_CONCURRENCY = 16;
const same_heads = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
export const create_library_manager = ({ content_store, projector, entry_blocks, state_store, on_entries, keeps_blobs = () => () => true, retained = () => new Set() }) => {
    const libraries = new Map();
    let indexing = Promise.resolve();
    // Item 6 holds and releases apply one at a time, so a release made after a
    // hold always undoes it, whichever await each was in. An open's re-pin pass
    // queues here too, so no release decides on a pin set it has not filled.
    let pin_tail = Promise.resolve();
    const exclusive_pins = async (job) => {
        const run = pin_tail.then(job);
        pin_tail = run.catch(() => { });
        return await run;
    };
    const require_library = (library_address) => {
        const handle = libraries.get(library_address);
        if (handle === undefined)
            throw new PeerError('not_found', `library not open: ${library_address}`);
        return handle;
    };
    let pin_passes_stopped = false;
    const pin_entries = async (handle, entries, { pass = false } = {}) => {
        const keeps = keeps_blobs(handle.chain);
        await run_bounded(entries, PIN_CONCURRENCY, async (entry) => {
            if (pass && pin_passes_stopped)
                return;
            await pin_into({ content_store, pins: handle.pins, items: await entry_pins({ content_store, library_address: handle.chain.address, entry, keeps_blobs: keeps }) });
        });
    };
    // The canonical CIDs some other library or a pin record still holds.
    const held_elsewhere = (library_address) => {
        const held = new Set(retained());
        for (const { chain, pins } of libraries.values()) {
            if (chain.address === library_address)
                continue;
            for (const cid of pins.keys())
                held.add(canonical_or_self(cid));
        }
        return held;
    };
    const release = async (handle, library_address, cids) => {
        if (pin_passes_stopped)
            throw new Error('the peer is stopping: blobs are not released');
        const held = held_elsewhere(library_address);
        for (const cid of cids) {
            if (!held.has(canonical_or_self(cid)))
                await content_store.unpin(cid);
            handle?.pins.delete(cid);
        }
    };
    const register = async ({ library_address, entries, access }) => {
        const handle = require_library(library_address);
        for (const entry of entries)
            await content_store.put(entry.hash, entry.bytes);
        entry_blocks.save({ library_address, entries, heads: handle.oplog.heads });
        await pin_entries(handle, entries);
        await state_store.save_heads({ library_address, heads: [...handle.oplog.heads] });
        const projected = projector.project_entries({ oplog: handle.oplog, entries, keys: access?.keys ?? [] });
        indexing = projected.catch(() => { });
        await projected;
        on_entries?.({ library_address, entries, inert: access?.inert ?? [] });
    };
    // The oplog at the persisted heads, from the entry block cache when it
    // reproduces them. A cache last written at those heads under the current
    // verification rules is restored without verifying each entry again; any
    // other cache is verified in full and, if it holds, marked verified.
    // Otherwise, as for a library cached before or whose cache fell behind a
    // crash, the oplog is walked from the blockstore, verified, and recached.
    const load_oplog = async (chain, heads) => {
        const library_address = chain.address;
        const { blocks, verified_heads } = entry_blocks.load(library_address);
        const trusted = verified_heads !== undefined && same_heads(verified_heads, heads);
        const cached = create_oplog({ chain });
        const from_cache = (trusted ? restore_entries : merge_entries)({ oplog: cached, blocks });
        if (from_cache.rejected.length === 0 && same_heads(cached.heads, heads)) {
            if (!trusted)
                entry_blocks.mark_verified({ library_address, heads: cached.heads });
            return { oplog: cached, loaded: from_cache };
        }
        const oplog = create_oplog({ chain });
        const loaded = merge_entries({ oplog, blocks: await load_entry_blocks({ heads, content_store }) });
        entry_blocks.replace({ library_address, entries: oplog.entries.values(), heads: oplog.heads });
        return { oplog, loaded };
    };
    // Resolving the chain is the gate (§3.5.1): a library that fails it never
    // gets an oplog. Its objects are pinned before any entry is loaded.
    const open_library = async (library_address) => {
        const existing = libraries.get(library_address);
        if (existing !== undefined)
            return existing;
        const chain = await resolve_ac_chain({ library_address, block_store: content_store });
        const pins = new Map();
        await pin_into({ content_store, pins, items: chain_pins(chain) });
        const heads = (await state_store.load()).heads.get(library_address) ?? [];
        const { oplog, loaded } = await load_oplog(chain, heads);
        const handle = { chain, oplog, pins };
        // A stored entry that no longer verifies, under a rule a later version
        // added, drops out of the oplog; that is never silent.
        const [first] = loaded.rejected;
        if (first !== undefined) {
            process.emitWarning(`library ${library_address}: ${loaded.rejected.length} stored entries failed verification at open and were left out; first ${first.hash}: ${first.error.code} ${first.error.message}`);
        }
        libraries.set(library_address, handle);
        const actual_heads = [...handle.oplog.heads].sort();
        await state_store.save_heads({ library_address, heads: actual_heads });
        // The persisted index covers the loaded oplog exactly when its marker names
        // the same heads; then the full replay is skipped and only the keys whose
        // content was missing at the last write are re-projected, so a payload
        // that arrived while the peer was down still fills in. Anything else — a
        // library not in the index, a schema change, or heads that no longer
        // reproduce after load — clears the library's rows and projects them over.
        const marker = await projector.projection_state({ library_address });
        if (marker !== undefined && JSON.stringify(marker.heads) === JSON.stringify(actual_heads)) {
            if (marker.pending.length > 0)
                await projector.project_keys({ oplog: handle.oplog, keys: marker.pending });
        }
        else {
            await projector.remove_library({ library_address });
            await projector.project_library({ oplog: handle.oplog });
        }
        // Re-pinning every entry repairs its pins and fills the pin set, at a few
        // small reads per entry: minutes for a large library on a slow disk. So
        // it runs after the open returns, queued with the holds and releases.
        exclusive_pins(async () => { await pin_entries(handle, handle.oplog.entries.values(), { pass: true }); }).catch((error) => {
            process.emitWarning(`library ${library_address}: re-pinning its entries at open failed: ${error.message}`);
        });
        return handle;
    };
    return {
        create_library: async ({ name, type, write_keys }) => {
            const { address } = await create_ac_chain({ name, type, write_keys, block_store: content_store });
            return await open_library(address);
        },
        open_library,
        begin_unlink: async (library_address) => {
            await state_store.set_unlinking({ library_address, unlinking: true });
        },
        // §4.6: release the chain, the entries, and the content this library held
        // unless another library still holds the same CID. Every step is
        // idempotent, so a finish after a crash repeats it safely. A library that
        // was never opened holds no pins.
        unlink_library: async (library_address) => {
            const handle = libraries.get(library_address);
            libraries.delete(library_address);
            // Every item 6 blob its entries reference, kept by the policy now or
            // before, since a pin outlives a policy change made while the peer was
            // down.
            const blobs = [];
            for (const entry of handle?.oplog.entries.values() ?? []) {
                const item = await stored_item_6({ content_store, library_address, entry });
                if (item !== undefined)
                    blobs.push(...item.blobs);
            }
            await exclusive_pins(async () => { await release(handle, library_address, new Set([...handle?.pins.keys() ?? [], ...blobs])); });
            await state_store.save_heads({ library_address, heads: undefined });
            await projector.remove_library({ library_address });
            entry_blocks.remove(library_address);
            await state_store.set_unlinking({ library_address, unlinking: false });
        },
        pending_unlinks: async () => [...(await state_store.load()).unlinking],
        load_policies: async () => (await state_store.load()).policies,
        save_policy: async (input) => { await state_store.save_policy(input); },
        get: (library_address) => libraries.get(library_address),
        list: () => [...libraries.values()],
        append: async ({ library_address, payload, key_pair }) => {
            const { oplog } = require_library(library_address);
            const { entry, access } = append_entry_with_access({ oplog, payload, key_pair });
            await register({ library_address, entries: [entry], access });
            return entry;
        },
        register,
        merge: async ({ library_address, blocks }) => {
            const { oplog } = require_library(library_address);
            const result = merge_entries({ oplog, blocks });
            if (result.merged.length > 0)
                await register({ library_address, entries: result.merged, access: result.access });
            return result;
        },
        reindex: async ({ library_address, entries }) => {
            const handle = require_library(library_address);
            await pin_entries(handle, entries);
            const keys = entries.flatMap(({ state_key }) => state_key === undefined ? [] : [state_key]);
            const projected = projector.project_keys({ oplog: handle.oplog, keys });
            indexing = projected.catch(() => { });
            await projected;
            on_entries?.({ library_address, entries, inert: [] });
        },
        hold_blobs: async ({ library_address, cids }) => await exclusive_pins(async () => {
            const handle = libraries.get(library_address);
            if (handle !== undefined)
                await pin_into({ content_store, pins: handle.pins, items: cids.map((cid) => [cid, true]) });
        }),
        release_unheld: async (cids) => await exclusive_pins(async () => { await release(undefined, '', cids); }),
        release_blobs: async ({ library_address, cids }) => await exclusive_pins(async () => {
            const handle = libraries.get(library_address);
            if (handle !== undefined)
                await release(handle, library_address, cids.filter((cid) => handle.pins.get(cid) === true));
        }),
        settled: async () => { await indexing; },
        pins_settled: async () => { await exclusive_pins(async () => { }); },
        stop_pin_passes: () => { pin_passes_stopped = true; }
    };
};
