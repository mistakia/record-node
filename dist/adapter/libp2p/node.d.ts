import { type GossipSub } from '@libp2p/gossipsub';
import { identify } from '@libp2p/identify';
import { type ConnectionGater, type Libp2p } from '@libp2p/interface';
import { ping } from '@libp2p/ping';
import { createHeliaLight, type Helia } from 'helia';
import type { Libp2pOptions } from 'libp2p';
import type { NetworkConfig, NetworkMode } from './config.ts';
import { type MainlineRendezvousService } from './mainline-rendezvous.ts';
export declare const RECORD_SWARM_KEY = "/key/swarm/psk/1.0.0/\n/base16/\ncbad12031badbcad2a3cd5a373633fa725a7874de942d451227a9e909733454a";
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
export declare const create_connection_gater: ({ mode, relay_address, relay_server }: NetworkConfig) => ConnectionGater;
export declare const create_libp2p_options: (config: NetworkConfig) => Libp2pOptions<RecordServices>;
export declare const RESERVATION_CHECK_MS = 10000;
export declare const create_networked_helia: ({ blockstore, datastore, network }: {
    blockstore: NonNullable<HeliaInit["blockstore"]>;
    datastore: NonNullable<HeliaInit["datastore"]>;
    network: NetworkConfig;
}) => Promise<NetworkedHelia>;
export {};
