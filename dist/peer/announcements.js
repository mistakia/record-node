// The peer's RECORD topic (§5.3): announcing its own About and the non-empty
// Abouts of its other own libraries and its linked libraries, and indexing what other peers announce. An
// announced library counts for a peer only once authenticate_announced has
// verified it; until then it is a hint and changes nothing local.
import { compute_about_id } from '#entry/id.ts';
import { is_put } from '#entry/operations.ts';
import { decode_payload } from '#entry/payload.ts';
import { RECORD_TOPIC } from '#fabric/pubsub.ts';
import { get_live_entry } from '#oplog/dag.ts';
import { authenticate_announced, create_announcer } from '#replication/announcement.ts';
import { build_loaded_about_entry, decode_announcement, encode_announcement } from '#replication/messages.ts';
import { is_record } from '#types/guards.ts';
import { default_own_library, linked_addresses, own_recordstore_addresses } from "./ownership.js";
// The About entry of an open, non-empty library, with its payload inlined.
const loaded_about = async (context, library_address) => {
    const oplog = context.libraries.get(library_address)?.oplog;
    if (oplog === undefined || oplog.entries.size === 0)
        return undefined;
    const entry = get_live_entry({ oplog, key: compute_about_id(library_address) });
    if (entry === undefined || !is_put(entry.operation))
        return undefined;
    const bytes = await context.content_store.get(entry.operation.value.content);
    const content = bytes === undefined ? undefined : decode_payload(bytes);
    return is_record(content) ? build_loaded_about_entry({ hash: entry.hash, entry: entry.entry, about_content: content }) : undefined;
};
export const create_peer_announcements = ({ context, network, timers, get_block, on_peer_join, on_peer_leave, on_library_verified }) => {
    const { pubsub } = network;
    const announced = new Map();
    const removals = [];
    const announcer = create_announcer({
        pubsub,
        interval_ms: context.config.announce_interval_ms,
        timers,
        build: async () => {
            // One own recordstore is announced as about, and the others with the
            // linked libraries in logs; the identity library never is (§5.3.2).
            if (context.identity === undefined)
                return undefined;
            const own_address = default_own_library(context);
            if (own_address === undefined)
                return undefined;
            const about = await loaded_about(context, own_address);
            if (about === undefined)
                return undefined;
            const others = [...own_recordstore_addresses(context).filter((address) => address !== own_address), ...linked_addresses(context)];
            const logs = await Promise.all(others.map(async (address) => await loaded_about(context, address)));
            return encode_announcement({ about, logs: logs.filter((log) => log !== undefined) });
        }
    });
    // §5.3.4: one at a time, so a hostile announcement costs fetches serially.
    const authenticate = async (record) => {
        for (const hint of record.hints) {
            if (await authenticate_announced({ announced: hint, get_block }) !== undefined) {
                record.verified.add(hint.address);
                on_library_verified?.(hint.address);
            }
        }
    };
    const receive = ({ from, data }) => {
        const message = decode_announcement(data);
        if (message === undefined)
            return;
        const record = { hints: [message.about, ...message.logs], verified: new Set() };
        announced.set(from, record);
        authenticate(record).catch(() => { });
    };
    return {
        start: async () => {
            await pubsub.subscribe(RECORD_TOPIC, receive);
            removals.push(pubsub.on_peer_join(RECORD_TOPIC, (peer_id) => {
                announcer.peer_joined(peer_id);
                on_peer_join(peer_id);
            }), pubsub.on_peer_leave(RECORD_TOPIC, (peer_id) => {
                announced.delete(peer_id);
                on_peer_leave(peer_id);
            }));
            announcer.announce_self();
        },
        stop: async () => {
            announcer.stop();
            for (const remove of removals.splice(0))
                remove();
            await pubsub.unsubscribe(RECORD_TOPIC);
        },
        announced_by: (peer_id) => announced.get(peer_id)
    };
};
