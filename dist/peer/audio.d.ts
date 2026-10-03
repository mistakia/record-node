import type { ContentStore } from '#fabric/content-store.ts';
import type { Network } from '#fabric/network.ts';
export interface AudioSource {
    read_local: (cid: string) => Promise<Uint8Array | undefined>;
    read: (cid: string) => Promise<Uint8Array | undefined>;
    cached_bytes: () => number;
}
export declare const create_audio_source: ({ content_store, network, timeout_ms, max_bytes }: {
    content_store: ContentStore;
    network: Network | undefined;
    timeout_ms: number;
    max_bytes: number;
}) => AudioSource;
