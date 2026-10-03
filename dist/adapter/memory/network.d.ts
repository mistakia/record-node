import type { ContentStore } from '#fabric/content-store.ts';
import type { Network } from '#fabric/network.ts';
export interface MemoryNetwork {
    join: (input: {
        content_store: ContentStore;
        peer_id?: string;
        max_topic_bytes?: number;
    }) => Network;
    set_serving: (input: {
        peer_id: string;
        serving: boolean;
    }) => void;
    readonly published: Array<{
        from: string;
        topic: string;
        data: Uint8Array;
    }>;
    readonly delivered: Array<{
        to: string;
        from: string;
        topic: string;
        data: Uint8Array;
    }>;
}
export declare const create_memory_network: () => MemoryNetwork;
