// One library's replication (§5.4): subscribe to the library topic, exchange
// heads, traverse from received heads, and merge what lands. The replicator
// owns the progress counters the API reports. Pause keeps the oplog open and
// only stops publishing and new fetches (§5.4.4); fetch failures never touch
// the oplog, so an unreachable library keeps what it has (§5.4.5).
import { decode_signed_entry } from '#entry/signed.ts';
import { check_entry } from '#oplog/accept.ts';
import { ProtocolError } from '#types/errors.ts';
import { create_heads_publisher, create_heads_receiver } from "./heads-exchange.js";
import { create_merge_orchestrator } from "./merge-orchestrator.js";
import { create_traversal } from "./traversal.js";
// A fetched entry must hash to the CID it was fetched by and pass every
// check the entry alone decides; the clock and a capability need its causal
// past, so the merge checks those once its next have landed (§5.4.2 item 5).
export const verify_fetched = (chain) => (hash, bytes) => {
    const hashed = decode_signed_entry(bytes);
    if (hashed.hash !== hash)
        throw new ProtocolError('cid_mismatch', `fetched ${hash}, got ${hashed.hash}`);
    return check_entry({ hashed, chain }).hashed;
};
export const create_replicator = ({ oplog, pubsub, fetch_block, merge, concurrency, timeout_ms, heads_interval_ms, timers, on_status, on_peer_join, on_peer_leave }) => {
    const library_address = oplog.chain.address;
    const is_landed = (hash) => oplog.entries.has(hash);
    let state = 'idle';
    let last_status = '';
    const removals = [];
    const publisher = create_heads_publisher({
        pubsub,
        topic: library_address,
        interval_ms: heads_interval_ms,
        get_heads: () => [...oplog.heads].sort(),
        timers
    });
    const report = () => {
        const current = status();
        const key = `${current.progress}/${current.total}`;
        if (key === last_status)
            return;
        last_status = key;
        on_status?.(current);
    };
    const orchestrator = create_merge_orchestrator({
        is_landed,
        merge: async (entries) => {
            const before = [...oplog.heads].sort().join();
            await merge(entries);
            if ([...oplog.heads].sort().join() !== before)
                publisher.trigger();
            report();
        }
    });
    const traversal = create_traversal({
        fetch: fetch_block,
        verify: verify_fetched(oplog.chain),
        is_landed,
        on_entry: (entry) => { orchestrator.add(entry); },
        on_change: report,
        concurrency,
        timeout_ms,
        timers
    });
    const status = () => {
        const progress = oplog.entries.size;
        return { progress, total: progress + traversal.outstanding() + orchestrator.pending() };
    };
    // Heads received while paused start no fetch; resume enqueues them after
    // the unresolved entries, since their sender will not repeat them unasked.
    const deferred = new Set();
    const receive = create_heads_receiver({
        on_snapshot: ({ heads }) => {
            if (state === 'running')
                traversal.enqueue(heads);
            else if (state === 'paused')
                for (const head of heads)
                    deferred.add(head);
        }
    });
    return {
        library_address,
        state: () => state,
        start: async () => {
            if (state !== 'idle')
                return;
            await pubsub.subscribe(library_address, (message) => { receive(message); });
            state = 'running';
            removals.push(pubsub.on_peer_join(library_address, (peer_id) => {
                publisher.trigger();
                on_peer_join?.(peer_id);
            }), pubsub.on_peer_leave(library_address, (peer_id) => { on_peer_leave?.(peer_id); }));
            publisher.trigger();
        },
        pause: () => {
            if (state !== 'running')
                return;
            state = 'paused';
            publisher.pause();
            traversal.pause();
        },
        resume: () => {
            if (state !== 'paused')
                return;
            state = 'running';
            traversal.resume();
            traversal.enqueue(deferred);
            deferred.clear();
            publisher.resume();
            publisher.trigger();
        },
        unlink: async () => {
            const subscribed = state === 'running' || state === 'paused';
            state = 'unlinked';
            publisher.pause();
            traversal.discard();
            orchestrator.discard();
            deferred.clear();
            for (const remove of removals.splice(0))
                remove();
            if (subscribed)
                await pubsub.unsubscribe(library_address);
            await orchestrator.settled();
        },
        heads_changed: () => {
            if (state === 'running')
                publisher.trigger();
        },
        status,
        peer_ids: () => pubsub.subscribers(library_address),
        idle: async () => {
            await traversal.idle();
            await orchestrator.settled();
            await publisher.flushed();
        },
        traversal
    };
};
