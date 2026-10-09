import type { ComponentLogger, Startable } from '@libp2p/interface';
import { type Multiaddr } from '@multiformats/multiaddr';
import { type MainlineRendezvousConfig } from './config.ts';
interface NodeAddress {
    multiaddr: Multiaddr;
    verified: boolean;
}
export interface MainlineRendezvousComponents {
    addressManager: {
        getAddressesWithMetadata: () => NodeAddress[];
    };
    connectionManager: {
        openConnection: (target: Multiaddr, options?: {
            signal?: AbortSignal;
        }) => Promise<unknown>;
        getConnections: () => Array<{
            remoteAddr: Multiaddr;
        }>;
    };
    events: EventTarget;
    logger: ComponentLogger;
}
export interface MainlineRendezvousService extends Startable {
    readonly [Symbol.toStringTag]: string;
    announced_port: () => number | null;
    count_addresses: () => Promise<number | null>;
}
export declare const confirmed_public_port: (addresses: NodeAddress[]) => number | null;
export declare const mainline_rendezvous: (config: MainlineRendezvousConfig) => (components: MainlineRendezvousComponents) => MainlineRendezvousService;
export {};
