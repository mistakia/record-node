// Heads exchange on a library's topic (§5.4.1). The publisher coalesces every
// trigger inside one 1000 ms window into a single heads message, split into
// incomplete: true parts when the set outgrows the size bound. The receiver
// assembles each sender's parts and hands on only complete snapshots.
import { decode_heads_message, encode_heads_batches } from "./messages.js";
export const create_heads_publisher = ({ pubsub, topic, interval_ms, get_heads, timers }) => {
    let last_sent = -Infinity;
    let scheduled;
    let paused = false;
    let sending = Promise.resolve();
    const send = async () => {
        for (const data of encode_heads_batches({ heads: get_heads() })) {
            try {
                await pubsub.publish(topic, data);
            }
            catch (error) {
                process.emitWarning(`heads publish on ${topic} failed: ${error.message}`);
            }
        }
    };
    const flush = () => {
        scheduled = undefined;
        if (paused)
            return;
        last_sent = timers.now();
        sending = sending.then(send);
    };
    return {
        trigger: () => {
            if (paused || scheduled !== undefined)
                return;
            scheduled = timers.set_timeout(flush, Math.max(0, last_sent + interval_ms - timers.now()));
        },
        pause: () => {
            paused = true;
            if (scheduled !== undefined)
                timers.clear_timeout(scheduled);
            scheduled = undefined;
        },
        resume: () => { paused = false; },
        flushed: async () => { await sending; }
    };
};
// A cap on one sender's pending parts, so a peer that never finishes a batch
// cannot grow it without bound.
const MAX_PENDING_HEADS = 1 << 16;
export const create_heads_receiver = ({ on_snapshot }) => {
    const pending = new Map();
    return ({ from, data }) => {
        const message = decode_heads_message(data);
        if (message === undefined)
            return;
        const heads = [...(pending.get(from) ?? []), ...message.heads];
        if (message.incomplete) {
            if (heads.length > MAX_PENDING_HEADS)
                pending.delete(from);
            else
                pending.set(from, heads);
            return;
        }
        pending.delete(from);
        on_snapshot({ from, heads });
    };
};
