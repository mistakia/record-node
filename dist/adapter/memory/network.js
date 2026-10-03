// An in-process network for tests: every joined peer is connected to every
// other, pubsub delivery is asynchronous, and a fetch reads the block out of
// another peer's content store. A peer can stop serving blocks to model a
// partition (§5.4.5).
import { assert_topic_fits, notify_all } from '#fabric/pubsub.ts';
const add_handler = (map, topic, handler) => {
    const handlers = map.get(topic) ?? new Set();
    map.set(topic, handlers.add(handler));
    return () => { handlers.delete(handler); };
};
export const create_memory_network = () => {
    const members = new Map();
    const published = [];
    const delivered = [];
    let next_id = 0;
    const others = (self) => [...members.values()].filter((member) => member !== self);
    const later = (job) => { setTimeout(job, 0); };
    const create_pubsub = (self, max_topic_bytes) => ({
        peer_id: self.peer_id,
        subscribe: async (topic, handler) => {
            assert_topic_fits({ topic, max_topic_bytes });
            const fresh = !self.topics.has(topic);
            self.topics.set(topic, handler);
            if (!fresh)
                return;
            for (const member of others(self)) {
                if (member.topics.has(topic))
                    later(() => { notify_all(member.joins.get(topic), self.peer_id); });
            }
        },
        unsubscribe: async (topic) => {
            if (!self.topics.delete(topic))
                return;
            for (const member of others(self)) {
                if (member.topics.has(topic))
                    later(() => { notify_all(member.leaves.get(topic), self.peer_id); });
            }
        },
        publish: async (topic, data) => {
            published.push({ from: self.peer_id, topic, data });
            for (const member of others(self)) {
                later(() => {
                    const handler = member.topics.get(topic);
                    if (handler === undefined)
                        return;
                    handler({ from: self.peer_id, data });
                    delivered.push({ to: member.peer_id, from: self.peer_id, topic, data });
                });
            }
        },
        on_peer_join: (topic, handler) => add_handler(self.joins, topic, handler),
        on_peer_leave: (topic, handler) => add_handler(self.leaves, topic, handler),
        subscribers: (topic) => others(self).filter((member) => member.topics.has(topic)).map(({ peer_id }) => peer_id)
    });
    return {
        published,
        delivered,
        join: ({ content_store, peer_id = `memory-peer-${next_id++}`, max_topic_bytes }) => {
            const self = { peer_id, content_store, topics: new Map(), joins: new Map(), leaves: new Map(), serving: true };
            members.set(peer_id, self);
            const pubsub = create_pubsub(self, max_topic_bytes);
            return {
                peer_id,
                pubsub,
                fetch_block: async (cid) => {
                    for (const member of others(self)) {
                        const bytes = member.serving ? await member.content_store.get(cid) : undefined;
                        if (bytes === undefined)
                            continue;
                        await content_store.put(cid, bytes);
                        return bytes;
                    }
                    return undefined;
                },
                list_peers: () => others(self).map((member) => ({ peer_id: member.peer_id, multiaddrs: [] })),
                addresses: () => [],
                close: async () => {
                    for (const topic of [...self.topics.keys()])
                        await pubsub.unsubscribe(topic);
                    members.delete(peer_id);
                }
            };
        },
        set_serving: ({ peer_id, serving }) => {
            const member = members.get(peer_id);
            if (member !== undefined)
                member.serving = serving;
        }
    };
};
