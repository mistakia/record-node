// State shared by the peer's lifecycle and its ApiPeer methods.
import { list_linked_libraries } from '#query-db/queries.ts';
export const require_identity = (context) => {
    if (context.identity === undefined)
        throw new Error('the peer is not started');
    return context.identity;
};
const enqueue = (tail, job) => {
    const run = tail.then(job);
    return { run, tail: run.catch(() => { }) };
};
const refuse_when_stopping = (context) => {
    if (context.stopping)
        throw new Error('the peer is stopping');
};
export const serialise_write = async (context, job) => {
    refuse_when_stopping(context);
    const { run, tail } = enqueue(context.writes, job);
    context.writes = tail;
    return run;
};
const serialise_ingest = async (context, job) => {
    refuse_when_stopping(context);
    const { run, tail } = enqueue(context.ingests, job);
    context.ingests = tail;
    return run;
};
// Waits until both queues are empty, including work queued while waiting.
export const drain_queues = async (context) => {
    for (;;) {
        const { writes, ingests } = context;
        await Promise.all([writes, ingests]);
        if (writes === context.writes && ingests === context.ingests)
            return;
    }
};
export const require_toolchain = async (context) => {
    if (context.toolchain === undefined)
        throw new Error('the peer is not started');
    return await context.toolchain;
};
// The libraries the own library links to (§2.5).
export const linked_addresses = (context) => list_linked_libraries({ db: context.db, library_address: require_identity(context).own_address }).map(({ address }) => address);
// The own library and what it links: the default scope of every query.
export const visible_addresses = (context) => [require_identity(context).own_address, ...linked_addresses(context)];
// Runs one ingest pipeline against the own library and indexes a new entry.
export const ingest_into_own = (context, run) => serialise_ingest(context, async () => {
    const { key_pair, own_address } = require_identity(context);
    const handle = context.libraries.get(own_address);
    if (handle === undefined)
        throw new Error('the own library is not open');
    const track = await run({ oplog: handle.oplog, key_pair, content_store: context.content_store });
    const entry = handle.oplog.entries.get(track.entry_hash);
    if (!track.existing && entry !== undefined)
        await context.libraries.register({ library_address: own_address, entries: [entry] });
    return track;
});
