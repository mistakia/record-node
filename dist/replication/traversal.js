// Bounded fetch traversal (§5.4.2): from heads along the union of next and
// refs, each hash enqueued once, at most `concurrency` fetches in flight,
// each under a timeout that records the entry unresolved rather than holding
// the traversal. An entry that fails verification, the fan-out cap included,
// is abandoned and enqueues none of its children. Pausable and resumable
// (§5.4.4): resume re-enters at the earliest unresolved entry and never
// re-fetches one that already landed.
import { ProtocolError } from '#types/errors.ts';
export const create_traversal = ({ fetch, verify, is_landed, on_entry, on_change, concurrency, timeout_ms, timers }) => {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1)
        throw new RangeError('traversal concurrency must be a finite positive integer');
    if (!Number.isFinite(timeout_ms) || timeout_ms <= 0)
        throw new RangeError('traversal timeout must be finite and positive');
    const enqueued = new Set();
    const fetched = new Set();
    const unresolved = new Set();
    const rejected = new Map();
    const in_flight = new Map();
    let queue = [];
    let paused = false;
    let waiters = [];
    const is_idle = () => in_flight.size === 0 && (paused || queue.length === 0);
    const changed = () => {
        on_change?.();
        if (!is_idle())
            return;
        const resolved = waiters;
        waiters = [];
        for (const resolve of resolved)
            resolve();
    };
    const settle = (hash, record) => {
        if (in_flight.get(hash) !== record)
            return false;
        timers.clear_timeout(in_flight.get(hash)?.timer);
        in_flight.delete(hash);
        return true;
    };
    const land = (hash, bytes) => {
        unresolved.delete(hash);
        let entry;
        try {
            entry = verify(hash, bytes);
        }
        catch (error) {
            if (!(error instanceof ProtocolError))
                throw error;
            rejected.set(hash, error);
            return;
        }
        fetched.add(hash);
        on_entry(entry);
        add([...entry.entry.next, ...entry.entry.refs]);
    };
    const start = (hash) => {
        const controller = new AbortController();
        const record = { controller, timer: undefined };
        in_flight.set(hash, record);
        record.timer = timers.set_timeout(() => {
            if (!settle(hash, record))
                return;
            controller.abort();
            unresolved.add(hash);
            pump();
        }, timeout_ms);
        fetch(hash, { signal: controller.signal }).then((bytes) => {
            if (!settle(hash, record))
                return;
            if (bytes === undefined)
                unresolved.add(hash);
            else
                land(hash, bytes);
            pump();
        }, () => {
            if (!settle(hash, record))
                return;
            unresolved.add(hash);
            pump();
        });
    };
    const pump = () => {
        if (!paused) {
            while (in_flight.size < concurrency && queue.length > 0) {
                const hash = queue.shift();
                if (!is_landed(hash) && !fetched.has(hash) && !in_flight.has(hash))
                    start(hash);
            }
        }
        changed();
    };
    const add = (hashes) => {
        for (const hash of hashes) {
            if (is_landed(hash))
                continue;
            if (!enqueued.has(hash)) {
                enqueued.add(hash);
                queue.push(hash);
            }
            else if (unresolved.has(hash) && !in_flight.has(hash)) {
                unresolved.delete(hash);
                queue.push(hash);
            }
        }
    };
    return {
        enqueue: (hashes) => {
            add(hashes);
            pump();
        },
        pause: () => {
            paused = true;
            for (const hash of in_flight.keys())
                unresolved.add(hash);
            changed();
        },
        resume: () => {
            paused = false;
            for (const hash of unresolved) {
                if (is_landed(hash))
                    unresolved.delete(hash);
            }
            const retry = [...unresolved].filter((hash) => !in_flight.has(hash));
            for (const hash of retry)
                unresolved.delete(hash);
            queue = [...retry, ...queue.filter((hash) => !retry.includes(hash))];
            pump();
        },
        discard: () => {
            for (const [hash, record] of in_flight) {
                settle(hash, record);
                record.controller.abort();
            }
            queue = [];
            enqueued.clear();
            fetched.clear();
            unresolved.clear();
            rejected.clear();
            changed();
        },
        idle: async () => {
            if (is_idle())
                return;
            await new Promise((resolve) => { waiters.push(resolve); });
        },
        enqueued,
        unresolved: () => [...unresolved],
        rejected,
        outstanding: () => new Set([...queue, ...in_flight.keys(), ...unresolved]).size
    };
};
