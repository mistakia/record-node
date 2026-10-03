// Library state kept outside the content store: the heads of every library
// the peer holds, so a restart can walk each oplog back out of the store, and
// the libraries whose unlink has begun, so an unlink a crash cut short is
// finished at the next start (§4.6). Entries, content, and the AC chain are
// all blocks.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const snapshot = (state) => ({ heads: new Map(state.heads), unlinking: new Set(state.unlinking) });
const apply_heads = (state, { library_address, heads }) => {
    if (heads === undefined)
        state.heads.delete(library_address);
    else
        state.heads.set(library_address, [...heads].sort());
};
const apply_unlinking = (state, { library_address, unlinking }) => {
    if (unlinking)
        state.unlinking.add(library_address);
    else
        state.unlinking.delete(library_address);
};
export const create_memory_state_store = () => {
    const state = { heads: new Map(), unlinking: new Set() };
    return {
        load: async () => snapshot(state),
        save_heads: async (input) => { apply_heads(state, input); },
        set_unlinking: async (input) => { apply_unlinking(state, input); }
    };
};
// One JSON file of { heads: { [library_address]: heads }, unlinking: [...] }.
// Writes are serialised and land by rename, so the file is always a complete
// earlier or later state, and a marker is on disk before set_unlinking returns.
export const create_file_state_store = ({ path }) => {
    let state;
    let tail = Promise.resolve();
    const read = async () => {
        if (state !== undefined)
            return state;
        try {
            const stored = JSON.parse(await readFile(path, 'utf8'));
            state = { heads: new Map(Object.entries(stored.heads)), unlinking: new Set(stored.unlinking) };
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            state = { heads: new Map(), unlinking: new Set() };
        }
        return state;
    };
    const update = async (change) => {
        const run = tail.then(async () => {
            const current = await read();
            change(current);
            await mkdir(dirname(path), { recursive: true });
            const temp_path = `${path}.tmp`;
            const stored = { heads: Object.fromEntries(current.heads), unlinking: [...current.unlinking].sort() };
            await writeFile(temp_path, `${JSON.stringify(stored, null, 2)}\n`);
            await rename(temp_path, path);
        });
        tail = run.catch(() => { });
        await run;
    };
    return {
        load: async () => snapshot(await read()),
        save_heads: async (input) => { await update((current) => { apply_heads(current, input); }); },
        set_unlinking: async (input) => { await update((current) => { apply_unlinking(current, input); }); }
    };
};
