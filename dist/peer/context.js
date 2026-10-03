// State shared by the peer's lifecycle and its ApiPeer methods.
import { assert_writable } from "./write-target.js";
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
// Waits until both queues are empty, including work queued while waiting.
// Waits until both queues are empty and no prepare is in flight, including
// work queued while waiting: a prepare that finishes still commits.
export const drain_queues = async (context) => {
    for (;;) {
        const { writes, ingests } = context;
        const preparing = [...context.prepares.in_flight];
        await Promise.allSettled([writes, ingests, ...preparing]);
        if (writes === context.writes && ingests === context.ingests && context.prepares.in_flight.size === 0)
            return;
    }
};
export const require_toolchain = async (context) => {
    if (context.toolchain === undefined)
        throw new Error('the peer is not started');
    return await context.toolchain;
};
// At most config.ingest_prepare_concurrency prepares run at once; the rest
// wait their turn in arrival order.
const run_prepare = async (context, job) => {
    const gate = context.prepares;
    if (gate.active >= context.config.ingest_prepare_concurrency) {
        await new Promise((resolve) => { gate.waiting.push(resolve); });
    }
    else {
        gate.active += 1;
    }
    const run = job();
    const tracked = run.then(() => { }, () => { });
    gate.in_flight.add(tracked);
    try {
        return await run;
    }
    finally {
        gate.in_flight.delete(tracked);
        const next = gate.waiting.shift();
        if (next === undefined)
            gate.active -= 1;
        else
            next();
    }
};
// One ingest against a write target, in two phases. prepare does the
// per-file work (decode, strip, blob import) and runs beside other prepares;
// commit makes the step 3 decision and appends, one at a time, so its dedup
// check stays atomic. A prepare accepted before stop still commits. The
// target is checked again at commit, since a library retired meanwhile
// refuses new writes (§4.8.3), and a new entry is indexed.
export const ingest_into = async (context, target, { prepare, commit, blobs }) => {
    refuse_when_stopping(context);
    const { key_pair } = require_identity(context);
    const track_target = { oplog: target.handle.oplog, key_pair, content_store: context.content_store, capability_id: target.capability_id };
    const prepared = await run_prepare(context, async () => await prepare(track_target));
    const release = async (cids) => { await context.libraries.release_unheld(cids); };
    const { run, tail } = enqueue(context.ingests, async () => {
        try {
            assert_writable(context, target);
        }
        catch (error) {
            await release(blobs(prepared));
            throw error;
        }
        const track = await commit({ target: track_target, prepared, release });
        const entry = target.handle.oplog.entries.get(track.entry_hash);
        if (!track.existing && entry !== undefined)
            await context.libraries.register({ library_address: target.address, entries: [entry] });
        return track;
    });
    context.ingests = tail;
    return await run;
};
