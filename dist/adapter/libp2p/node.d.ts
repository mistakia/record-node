import { type GossipSub } from '@libp2p/gossipsub';
import { identify } from '@libp2p/identify';
import { type ConnectionGater, type Libp2p } from '@libp2p/interface';
import { ping } from '@libp2p/ping';
import { createHeliaLight, type Helia } from 'helia';
import type { Libp2pOptions } from 'libp2p';
import type { NetworkConfig, NetworkMode } from './config.ts';
import { type MainlineRendezvousService } from './mainline-rendezvous.ts';
export declare const RECORD_SWARM_KEY = "/key/swarm/psk/1.0.0/\n/base16/\n759610a71c3687e6644664f722dbc6d83c6c0651266f4b2f4c91beecbfb61a55";
export type RecordServices = {
    identify: ReturnType<ReturnType<typeof identify>>;
    ping: ReturnType<ReturnType<typeof ping>>;
    pubsub: GossipSub;
    dht?: unknown;
    mainline_rendezvous?: MainlineRendezvousService;
};
export type RecordLibp2p = Libp2p<RecordServices>;
export type NetworkedHelia = Helia & {
    libp2p: RecordLibp2p;
};
type HeliaInit = NonNullable<Parameters<typeof createHeliaLight>[0]>;
export declare const agent_string: (mode: NetworkMode, version?: string) => string;
export declare const create_connection_gater: ({ mode, relay_address, relay_server, peer_allowlist }: NetworkConfig) => ConnectionGater;
export declare const create_libp2p_options: (config: NetworkConfig) => Libp2pOptions<RecordServices>;
export declare const RESERVATION_CHECK_MS = 10000;
export declare const RESERVATION_REFRESH_MS: number;
export declare const keep_relay_reservation: (libp2p: RecordLibp2p, relay_address: string, { check_interval_ms, refresh_after_ms }?: {
    check_interval_ms?: number;
    refresh_after_ms?: number;
}) => void;
export declare const create_networked_helia: ({ blockstore, datastore, network }: {
    blockstore: NonNullable<HeliaInit["blockstore"]>;
    datastore: NonNullable<HeliaInit["datastore"]>;
    network: NetworkConfig;
}) => Promise<NetworkedHelia>;
export {};
