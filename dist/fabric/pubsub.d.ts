export declare const RECORD_TOPIC = "RECORD";
export interface PubSubMessage {
    readonly from: string;
    readonly data: Uint8Array;
}
export type MessageHandler = (message: PubSubMessage) => void;
export type PeerHandler = (peer_id: string) => void;
export interface PubSub {
    readonly peer_id: string;
    subscribe: (topic: string, handler: MessageHandler) => Promise<void>;
    unsubscribe: (topic: string) => Promise<void>;
    publish: (topic: string, data: Uint8Array) => Promise<void>;
    on_peer_join: (topic: string, handler: PeerHandler) => () => void;
    on_peer_leave: (topic: string, handler: PeerHandler) => () => void;
    subscribers: (topic: string) => string[];
}
export declare const assert_topic_fits: ({ topic, max_topic_bytes }: {
    topic: string;
    max_topic_bytes: number | undefined;
}) => void;
export declare const notify_all: <T>(handlers: Iterable<(value: T) => void> | undefined, value: T) => void;
