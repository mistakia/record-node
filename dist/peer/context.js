// State shared by the peer's lifecycle and its ApiPeer methods.
import { list_linked_libraries } from '#query-db/queries.ts';
export const require_identity = (context) => {
    if (context.identity === undefined)
        throw new Error('the peer is not started');
    return context.identity;
};
export const serialise_write = (context, job) => {
    const run = context.writes.then(job);
    context.writes = run.catch(() => { });
    return run;
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
export const ingest_into_own = (context, run) => serialise_write(context, async () => {
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
