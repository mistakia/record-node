// One request's allowance of time spent waiting on peers for blocks
// (audio_fetch_timeout_ms, chapter 8 §8.6.5a). Only the waits count, not the
// time between them, so a stream its client reads slowly is not cut off
// partway. A request that closes stops its waits too, so a player seeking
// away does not leave a fetch running for nobody.
// Returns a fetch of one block within what is left of the budget; it resolves
// undefined when no peer serves the block in time, the budget is spent, or
// the request has closed.
export const create_peer_wait_budget = ({ network, timeout_ms, closed }) => {
    let remaining_ms = timeout_ms;
    return async (cid) => {
        if (remaining_ms < 1 || closed?.aborted === true)
            return undefined;
        // Node's AbortSignal.timeout takes whole milliseconds only.
        const deadline = AbortSignal.timeout(Math.floor(remaining_ms));
        const started_at = performance.now();
        try {
            return await network.fetch_block(cid, { signal: closed === undefined ? deadline : AbortSignal.any([deadline, closed]) });
        }
        finally {
            remaining_ms -= performance.now() - started_at;
        }
    };
};
