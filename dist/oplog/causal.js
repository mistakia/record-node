// Causal past (§3.5.6): the entries reachable from an entry through next,
// transitively. clock.time grows strictly along next (§4.2), so a walk looking
// for one ancestor never descends past that ancestor's clock.
export const in_causal_past = ({ entries, ancestor, next }) => {
    const floor = entries.get(ancestor)?.entry.clock.time;
    if (floor === undefined)
        return false;
    const seen = new Set();
    const stack = [...next];
    for (let hash = stack.pop(); hash !== undefined; hash = stack.pop()) {
        if (hash === ancestor)
            return true;
        if (seen.has(hash))
            continue;
        seen.add(hash);
        const entry = entries.get(hash)?.entry;
        if (entry !== undefined && entry.clock.time > floor)
            stack.push(...entry.next);
    }
    return false;
};
