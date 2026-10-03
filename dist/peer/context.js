// State shared by the peer's lifecycle and its ApiPeer methods.
export const require_identity = (context) => {
    if (context.identity === undefined)
        throw new Error('the peer is not started');
    return context.identity;
};
const enqueue = (tail, job) => {
    const run = tail.then(job);
    return { run, tail: run.catch(() => { }) };
};
export const refuse_when_stopping = (context) => {
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
// Runs one ingest pipeline against a write target and indexes a new entry.
export const ingest_into = (context, target, run) => serialise_ingest(context, async () => {
    const { key_pair } = require_identity(context);
    const track = await run({ oplog: target.handle.oplog, key_pair, content_store: context.content_store, capability_id: target.capability_id });
    const entry = target.handle.oplog.entries.get(track.entry_hash);
    if (!track.existing && entry !== undefined)
        await context.libraries.register({ library_address: target.address, entries: [entry] });
    return track;
});
