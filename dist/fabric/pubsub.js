// Publish-subscribe boundary (§5.1, §5.3.1): the RECORD announcement topic
// and one replication topic per library address. Messages are raw bytes; the
// replication engine owns their JSON bodies.
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { ProtocolError } from '#types/errors.ts';
// Exactly the six ASCII bytes 52 45 43 4f 52 44 (§5.3.1).
export const RECORD_TOPIC = 'RECORD';
// A runtime with no topic length limit passes undefined.
export const assert_topic_fits = ({ topic, max_topic_bytes }) => {
    const size = utf8ToBytes(topic).length;
    if (max_topic_bytes !== undefined && size > max_topic_bytes) {
        throw new ProtocolError('topic_too_long', `topic is ${size} bytes, over the pubsub runtime's ${max_topic_bytes}-byte limit: ${topic}`);
    }
};
// Calls every handler in a set, so one that throws never stops the others.
export const notify_all = (handlers, value) => {
    for (const handler of handlers ?? []) {
        try {
            handler(value);
        }
        catch (error) {
            process.emitWarning(`pubsub handler threw: ${error.message}`);
        }
    }
};
