// The heads of every library the peer holds, persisted so a restart can walk
// each oplog back out of the content store. Heads are the only library state
// kept outside the store: entries, content, and the AC chain are all blocks.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
export const create_memory_heads_store = () => {
    const heads = new Map();
    return {
        load: async () => new Map(heads),
        save: async ({ library_address, heads: next }) => {
            if (next === undefined)
                heads.delete(library_address);
            else
                heads.set(library_address, [...next]);
        }
    };
};
// One JSON file of { [library_address]: heads }. Writes are serialised and
// land by rename, so the file is always a complete earlier or later state.
export const create_file_heads_store = ({ path }) => {
    let heads;
    let tail = Promise.resolve();
    const read = async () => {
        if (heads !== undefined)
            return heads;
        try {
            heads = new Map(Object.entries(JSON.parse(await readFile(path, 'utf8'))));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            heads = new Map();
        }
        return heads;
    };
    const write = async (state) => {
        await mkdir(dirname(path), { recursive: true });
        const temp_path = `${path}.tmp`;
        await writeFile(temp_path, `${JSON.stringify(Object.fromEntries(state), null, 2)}\n`);
        await rename(temp_path, path);
    };
    return {
        load: async () => new Map(await read()),
        save: async ({ library_address, heads: next }) => {
            const run = tail.then(async () => {
                const state = await read();
                if (next === undefined)
                    state.delete(library_address);
                else
                    state.set(library_address, [...next].sort());
                await write(state);
            });
            tail = run.catch(() => { });
            await run;
        }
    };
};
