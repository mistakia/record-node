import { type Helia } from 'helia';
import type { ContentStore } from '#fabric/content-store.ts';
export interface PeerStore {
    readonly helia: Helia;
    readonly content_store: ContentStore;
}
export declare const open_peer_store: ({ data_dir }: {
    data_dir: string | undefined;
}) => Promise<PeerStore>;
