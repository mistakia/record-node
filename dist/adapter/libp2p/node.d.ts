import { type GossipSub } from '@libp2p/gossipsub';
import { identify } from '@libp2p/identify';
import type { Libp2p } from '@libp2p/interface';
import { ping } from '@libp2p/ping';
import { createHeliaLight, type Helia } from 'helia';
import type { Libp2pOptions } from 'libp2p';
import type { NetworkConfig } from './config.ts';
export declare const RECORD_SWARM_KEY = "/key/swarm/psk/1.0.0/\n/base16/\ncbad12031badbcad2a3cd5a373633fa725a7874de942d451227a9e909733454a";
export type RecordServices = {
    identify: ReturnType<ReturnType<typeof identify>>;
    ping: ReturnType<ReturnType<typeof ping>>;
    pubsub: GossipSub;
    dht?: unknown;
};
export type RecordLibp2p = Libp2p<RecordServices>;
export type NetworkedHelia = Helia & {
    libp2p: RecordLibp2p;
};
type HeliaInit = NonNullable<Parameters<typeof createHeliaLight>[0]>;
export declare const create_libp2p_options: ({ listen, bootstrap: bootstrap_list, mdns: use_mdns, dht }: NetworkConfig) => Libp2pOptions<RecordServices>;
export declare const create_networked_helia: ({ blockstore, datastore, network }: {
    blockstore: NonNullable<HeliaInit["blockstore"]>;
    datastore: NonNullable<HeliaInit["datastore"]>;
    network: NetworkConfig;
}) => Promise<NetworkedHelia>;
export {};
