import type { ContentStore } from '#fabric/content-store.ts';
import type { Network } from '#fabric/network.ts';
export declare const IMAGE_MAX_BYTES: number;
export interface ImageSource {
    read_local: (cid: string) => Promise<Uint8Array | undefined>;
    read: (cid: string) => Promise<Uint8Array | undefined>;
}
export declare const create_image_source: ({ content_store, network, timeout_ms }: {
    content_store: ContentStore;
    network: Network | undefined;
    timeout_ms: number;
}) => ImageSource;
