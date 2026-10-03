import type { Network } from '#fabric/network.ts';
import type { NetworkedHelia } from './node.ts';
export declare const create_libp2p_network: ({ helia }: {
    helia: NetworkedHelia;
}) => Network;
export declare const dials_drained: (libp2p: {
    getDialQueue: () => unknown[];
}, timeout_ms?: number) => Promise<void>;
