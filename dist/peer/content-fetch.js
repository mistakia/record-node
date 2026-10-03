// Content payloads of merged entries (§5.4.3): fetched from peers after the
// merge, pinned and re-indexed once they land. One that no peer serves yet is
// kept and retried when a peer joins the library topic or replication resumes.
import { is_put } from '#entry/operations.ts';
// Runs jobs with at most `limit` in flight.
const run_bounded = async (items, limit, job) => {
    const queue = [...items];
    const worker = async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift())
            await job(item);
    };
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
};
export const create_content_fetcher = ({ context, get_block }) => {
    const { config, content_store, libraries } = context;
    const missing = new Map();
    const jobs = new Map();
    const fetch_all = async (library_address, entries) => {
        const arrived = [];
        const waiting = missing.get(library_address) ?? new Map();
        missing.set(library_address, waiting);
        await run_bounded(entries, config.traversal_concurrency, async (entry) => {
            if (!is_put(entry.operation) || await content_store.has(entry.operation.value.content))
                return;
            if (await get_block(entry.operation.value.content) === undefined)
                waiting.set(entry.hash, entry);
            else
                arrived.push(entry);
        });
        for (const { hash } of arrived)
            waiting.delete(hash);
        if (arrived.length > 0 && libraries.get(library_address) !== undefined)
            await libraries.reindex({ library_address, entries: arrived });
    };
    const fetch = ({ library_address, entries }) => {
        const running = jobs.get(library_address) ?? new Set();
        jobs.set(library_address, running);
        const job = fetch_all(library_address, entries);
        running.add(job);
        job.catch((error) => { process.emitWarning(`content fetch for ${library_address} failed: ${error.message}`); })
            .finally(() => { running.delete(job); });
    };
    return {
        fetch,
        retry_missing: (library_address) => {
            const waiting = missing.get(library_address);
            if (waiting !== undefined && waiting.size > 0)
                fetch({ library_address, entries: [...waiting.values()] });
        },
        forget: (library_address) => { missing.delete(library_address); },
        settled: async (library_address) => {
            for (;;) {
                const running = [...(jobs.get(library_address) ?? [])];
                if (running.length === 0)
                    return;
                await Promise.allSettled(running);
            }
        }
    };
};
