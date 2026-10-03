// Merge orchestration (§5.4.3): fetched entries wait until their transitive
// next closure is local or merge-ready, then merge in batches behind one
// per-library queue, so concurrent heads messages end in the state of some
// sequential merge order. An entry with an unfetched or abandoned ancestor
// never merges, and one whose ancestor the merge rejected is dropped.
export const create_merge_orchestrator = ({ is_landed, merge }) => {
    const fetched = new Map();
    const rejected = new Set();
    let tail = Promise.resolve();
    let scheduled = false;
    // Iterative, since a long chain would overflow a recursive walk. A cycle
    // leaves its members not ready.
    const ready_batch = () => {
        const ready = new Map();
        for (const root of fetched.keys()) {
            const stack = [root];
            const on_path = new Set();
            while (stack.length > 0) {
                const hash = stack[stack.length - 1];
                const entry = fetched.get(hash);
                if (ready.has(hash) || is_landed(hash) || entry === undefined) {
                    if (!ready.has(hash))
                        ready.set(hash, is_landed(hash));
                    stack.pop();
                }
                else if (!on_path.has(hash)) {
                    on_path.add(hash);
                    for (const parent of entry.entry.next) {
                        if (!ready.has(parent) && !on_path.has(parent))
                            stack.push(parent);
                    }
                }
                else {
                    ready.set(hash, entry.entry.next.every((parent) => ready.get(parent) === true));
                    on_path.delete(hash);
                    stack.pop();
                }
            }
        }
        return [...fetched.values()].filter(({ hash }) => ready.get(hash) === true);
    };
    // Drops every waiting entry that descends from a rejected one.
    const drop_rejected_descendants = () => {
        for (let changed = true; changed;) {
            changed = false;
            for (const [hash, entry] of fetched) {
                if (!entry.entry.next.some((parent) => rejected.has(parent)))
                    continue;
                fetched.delete(hash);
                rejected.add(hash);
                changed = true;
            }
        }
    };
    const run = async () => {
        scheduled = false;
        const batch = ready_batch();
        if (batch.length === 0)
            return;
        for (const { hash } of batch)
            fetched.delete(hash);
        try {
            await merge(batch);
        }
        catch (error) {
            // Kept for the next run rather than lost to the traversal, which never
            // fetches an entry twice.
            for (const entry of batch)
                fetched.set(entry.hash, entry);
            throw error;
        }
        // A ready entry that did not land failed verification at merge.
        for (const { hash } of batch)
            if (!is_landed(hash))
                rejected.add(hash);
        drop_rejected_descendants();
    };
    return {
        add: (entry) => {
            if (entry.entry.next.some((parent) => rejected.has(parent))) {
                rejected.add(entry.hash);
                return;
            }
            fetched.set(entry.hash, entry);
            if (scheduled)
                return;
            scheduled = true;
            tail = tail.then(run).catch((error) => {
                process.emitWarning(`replication merge failed: ${error.message}`);
            });
        },
        pending: () => fetched.size,
        settled: async () => {
            for (let current = tail;; current = tail) {
                await current;
                if (current === tail)
                    return;
            }
        },
        discard: () => {
            fetched.clear();
            rejected.clear();
        }
    };
};
