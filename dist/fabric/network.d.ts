import type { PubSub } from './pubsub.ts';
export interface NetworkPeer {
    readonly peer_id: string;
    readonly multiaddrs: string[];
    readonly connected_at_ms?: number;
}
export interface Network {
    readonly peer_id: string;
    readonly pubsub: PubSub;
    fetch_block: (cid: string, options: {
        signal: AbortSignal;
    }) => Promise<Uint8Array | undefined>;
    list_peers: () => NetworkPeer[];
    addresses: () => string[];
    close: () => Promise<void>;
}
