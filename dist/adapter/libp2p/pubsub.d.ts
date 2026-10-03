import { type PubSub } from '#fabric/pubsub.ts';
import type { RecordLibp2p } from './node.ts';
export declare const create_gossipsub_pubsub: ({ libp2p }: {
    libp2p: RecordLibp2p;
}) => PubSub & {
    close: () => void;
};
