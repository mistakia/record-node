import { type Helia } from 'helia';
import type { NetworkConfig } from '#adapter/libp2p/config.ts';
import type { ContentStore } from '#fabric/content-store.ts';
import type { Network } from '#fabric/network.ts';
export interface PeerStore {
    readonly helia: Helia;
    readonly content_store: ContentStore;
    readonly network: Network | undefined;
    readonly stop: () => Promise<void>;
}
export declare const open_peer_store: ({ data_dir, network }: {
    data_dir: string | undefined;
    network: NetworkConfig | false;
}) => Promise<PeerStore>;
