// Library lifecycle (§3.5.1, §4.6): create, open, close, and unlink, plus the
// write path every entry takes on its way into an open library. The manager
// holds the per-library pin sets, so unlink can release exactly what no other
// library still holds; the store's pins themselves do not count references.
import { create_ac_chain } from '#access-control/create.ts';
import { resolve_ac_chain } from '#access-control/resolve.ts';
import { is_put } from '#entry/operations.ts';
import { append_entry_with_access, create_oplog } from '#oplog/dag.ts';
import { merge_entries, restore_entries } from '#oplog/merge.ts';
import { PeerError } from '#types/peer.ts';
import { run_bounded } from "./bounded.js";
import { load_entry_blocks } from "./load.js";
import { open_phases } from "./open-phases.js";
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
export const create_library_manager = ({ content_store, projector, entry_blocks, state_store, pin_record, on_entries, keeps_blobs = () => () => true, retained = () => new Set() }) => {
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
    // Per open library: the pin set changes in flight, and whether a pass has
    // filled the set since the open.
    const pin_states = new Map();
    // Every change to a library's pin set runs here, so its record is dirty
    // while any change is in flight, and clean again once none is and the
    // set is complete.
    const changing_pins = async (handle, job) => {
        const library_address = handle.chain.address;
        const state = pin_states.get(library_address);
        if (pin_record === undefined || state === undefined)
            return await job();
        if (state.changing++ === 0)
            pin_record.begin(library_address);
        try {
            return await job();
        }
        finally {
            state.changing -= 1;
            if (state.changing === 0 && state.complete && libraries.get(library_address) === handle)
                pin_record.settle(library_address);
        }
    };
    const record_pins = (handle, added) => {
        if (added.length > 0)
            pin_record?.set(handle.chain.address, added);
    };
    const pin_entries = async (handle, entries, { pass = false } = {}) => {
        const keeps = keeps_blobs(handle.chain);
        await run_bounded(entries, PIN_CONCURRENCY, async (entry) => {
            if (pass && pin_passes_stopped)
                return;
            record_pins(handle, await pin_into({ content_store, pins: handle.pins, items: await entry_pins({ content_store, library_address: handle.chain.address, entry, keeps_blobs: keeps }) }));
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
            if (handle?.pins.delete(cid) === true)
                pin_record?.delete(library_address, [cid]);
        }
    };
    // Pins, persists heads for, and indexes entries whose blocks are stored.
    const index_stored = async ({ library_address, entries, access }) => {
        const handle = require_library(library_address);
        entry_blocks.save({ library_address, entries, heads: handle.oplog.heads });
        await changing_pins(handle, async () => { await pin_entries(handle, entries); });
        await state_store.save_heads({ library_address, heads: [...handle.oplog.heads] });
        const projected = projector.project_entries({ oplog: handle.oplog, entries, keys: access?.keys ?? [] });
        indexing = projected.catch(() => { });
        await projected;
        on_entries?.({ library_address, entries, inert: access?.inert ?? [] });
    };
    const register = async ({ library_address, entries, access }) => {
        require_library(library_address);
        for (const entry of entries)
            await content_store.put(entry.hash, entry.bytes);
        await index_stored({ library_address, entries, access });
    };
    // Each block is stored before the next turn, since any register in that
    // turn persists heads that already name it.
    // The oplog at the persisted heads, from the entry block cache when it
    // reproduces them. A cache last written at those heads under the current
    // verification rules is restored without verifying each entry again; any
    // other cache is verified in full and, if it holds, marked verified.
    // Otherwise, as for a library cached before or whose cache fell behind a
    // crash, the oplog is walked from the blockstore, verified, and recached.
    const load_oplog = async (chain, heads, phases) => {
        const library_address = chain.address;
        const { blocks, verified_heads } = phases.time('read_cache', () => entry_blocks.load(library_address));
        const trusted = verified_heads !== undefined && same_heads(verified_heads, heads);
        const cached = create_oplog({ chain });
        const from_cache = phases.time(trusted ? 'restore' : 'verify_cache', () => (trusted ? restore_entries : merge_entries)({ oplog: cached, blocks }));
        if (from_cache.rejected.length === 0 && same_heads(cached.heads, heads)) {
            if (!trusted)
                entry_blocks.mark_verified({ library_address, heads: cached.heads });
            return { oplog: cached, loaded: from_cache };
        }
        const oplog = create_oplog({ chain });
        const walked = await phases.time_async('walk_blocks', async () => await load_entry_blocks({ heads, content_store }));
        const loaded = phases.time('verify_walk', () => merge_entries({ oplog, blocks: walked }));
        phases.time('write_cache', () => { entry_blocks.replace({ library_address, entries: oplog.entries.values(), heads: oplog.heads }); });
        return { oplog, loaded };
    };
    // Resolving the chain is the gate (§3.5.1): a library that fails it never
    // gets an oplog. Its objects are pinned before any entry is loaded.
    // Concurrent opens of one library share a single load. Without it, two
    // callers that reach the open before either sets the handle both load and
    // project the library: on base-storage's 2.0.0 rehearsal the 800,000-entry
    // archive was projected twice, doubling the start.
    const opening = new Map();
    const open_library = async (library_address) => {
        const existing = libraries.get(library_address);
        if (existing !== undefined)
            return existing;
        const pending = opening.get(library_address);
        if (pending !== undefined)
            return await pending;
        const load = load_library(library_address).finally(() => { opening.delete(library_address); });
        opening.set(library_address, load);
        return await load;
    };
    const load_library = async (library_address) => {
        const phases = open_phases();
        const chain = await phases.time_async('resolve_chain', async () => await resolve_ac_chain({ library_address, block_store: content_store }));
        const pins = new Map();
        const chain_held = await pin_into({ content_store, pins, items: chain_pins(chain) });
        const heads = (await state_store.load()).heads.get(library_address) ?? [];
        const { oplog, loaded } = await load_oplog(chain, heads, phases);
        const handle = { chain, oplog, pins };
        // A stored entry that no longer verifies, under a rule a later version
        // added, drops out of the oplog; that is never silent.
        const [first] = loaded.rejected;
        if (first !== undefined) {
            process.emitWarning(`library ${library_address}: ${loaded.rejected.length} stored entries failed verification at open and were left out; first ${first.hash}: ${first.error.code} ${first.error.message}`);
        }
        libraries.set(library_address, handle);
        pin_states.set(library_address, { changing: 0, complete: false });
        const actual_heads = [...handle.oplog.heads].sort();
        await state_store.save_heads({ library_address, heads: actual_heads });
        // The persisted index covers the loaded oplog exactly when its marker names
        // the same heads; then the full replay is skipped and only the keys whose
        // content was missing at the last write are re-projected, so a payload
        // that arrived while the peer was down still fills in. Anything else — a
        // library not in the index, a schema change, or heads that no longer
        // reproduce after load — clears the library's rows and projects them over.
        const marker = await projector.projection_state({ library_address });
        await phases.time_async('project', async () => {
            if (marker !== undefined && JSON.stringify(marker.heads) === JSON.stringify(actual_heads)) {
                if (marker.pending.length > 0)
                    await projector.project_keys({ oplog: handle.oplog, keys: marker.pending });
            }
            else {
                await projector.remove_library({ library_address });
                await projector.project_library({ oplog: handle.oplog });
            }
        });
        // A clean recorded pin set is the set as the last run left it, so only
        // entries it does not cover are pinned again: ones whose block or content
        // payload it lacks, as after a crash between an entry's heads and its
        // pins. Any other set is dropped and refilled by pinning every entry.
        const recorded = phases.time('load_pins', () => pin_record?.load(library_address));
        if (recorded === undefined)
            pin_record?.clear(library_address);
        else
            for (const [cid, recursive] of recorded)
                if (pins.get(cid) !== true)
                    pins.set(cid, recursive);
        const unpinned = recorded === undefined
            ? [...handle.oplog.entries.values()]
            : [...handle.oplog.entries.values()].filter((entry) => !recorded.has(entry.hash) || (is_put(entry.operation) && !recorded.has(entry.operation.value.content)));
        const unrecorded = recorded === undefined ? chain_held : chain_held.filter(([cid, recursive]) => recorded.get(cid) !== recursive);
        phases.report(`library ${library_address} opened with ${handle.oplog.entries.size} entries`);
        // Re-pinning an entry repairs its pins and fills the pin set, at a few
        // small reads per entry: minutes for every entry of a large library on a
        // slow disk. So it runs after the open returns, queued with the holds and
        // releases.
        exclusive_pins(async () => {
            const state = pin_states.get(library_address);
            if (unpinned.length === 0 && unrecorded.length === 0) {
                if (state !== undefined)
                    state.complete = true;
                return;
            }
            const pass = open_phases();
            await changing_pins(handle, async () => {
                record_pins(handle, unrecorded);
                await pass.time_async('repin', async () => { await pin_entries(handle, unpinned, { pass: true }); });
                if (!pin_passes_stopped && state !== undefined)
                    state.complete = true;
            });
            pass.report(`library ${library_address} re-pinned ${unpinned.length} of ${handle.oplog.entries.size} entries`);
        }).catch((error) => {
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
            pin_states.delete(library_address);
            pin_record?.clear(library_address);
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
            await changing_pins(handle, async () => { await pin_entries(handle, entries); });
            const keys = entries.flatMap(({ state_keys }) => state_keys);
            const projected = projector.project_keys({ oplog: handle.oplog, keys });
            indexing = projected.catch(() => { });
            await projected;
            on_entries?.({ library_address, entries, inert: [] });
        },
        hold_blobs: async ({ library_address, cids }) => await exclusive_pins(async () => {
            const handle = libraries.get(library_address);
            if (handle !== undefined) {
                await changing_pins(handle, async () => {
                    record_pins(handle, await pin_into({ content_store, pins: handle.pins, items: cids.map((cid) => [cid, true]) }));
                });
            }
        }),
        release_unheld: async (cids) => await exclusive_pins(async () => { await release(undefined, '', cids); }),
        release_blobs: async ({ library_address, cids }) => await exclusive_pins(async () => {
            const handle = libraries.get(library_address);
            if (handle !== undefined)
                await changing_pins(handle, async () => { await release(handle, library_address, cids.filter((cid) => handle.pins.get(cid) === true)); });
        }),
        settled: async () => { await indexing; },
        pins_settled: async () => { await exclusive_pins(async () => { }); },
        stop_pin_passes: () => { pin_passes_stopped = true; }
    };
};
