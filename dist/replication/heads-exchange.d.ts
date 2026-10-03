import type { PubSub, PubSubMessage } from '#fabric/pubsub.ts';
import type { Timers } from './timers.ts';
export interface HeadsPublisher {
    trigger: () => void;
    pause: () => void;
    resume: () => void;
    flushed: () => Promise<void>;
}
export declare const create_heads_publisher: ({ pubsub, topic, interval_ms, get_heads, timers }: {
    pubsub: PubSub;
    topic: string;
    interval_ms: number;
    get_heads: () => readonly string[];
    timers: Timers;
}) => HeadsPublisher;
export declare const create_heads_receiver: ({ on_snapshot }: {
    on_snapshot: (snapshot: {
        from: string;
        heads: readonly string[];
    }) => void;
}) => ({ from, data }: PubSubMessage) => void;
