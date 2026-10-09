import type { PubSub } from './pubsub.ts';
export interface NetworkObservations {
    on_connection_open: (listener: (peer_id: string) => void) => () => void;
    on_peer_identify: (listener: (peer_id: string, agent: string | undefined) => void) => () => void;
    connected_peer_count: () => number;
    count_rendezvous_addresses: () => Promise<number | null>;
}
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
    readonly observations?: NetworkObservations;
    close: () => Promise<void>;
}
