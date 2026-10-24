import type { DatabaseSync } from 'node:sqlite';
import type { ContentStore } from '#fabric/content-store.ts';
import type { Network } from '#fabric/network.ts';
import { type Download } from '#ingest/download.ts';
import { type KeyPair } from '#identity/key-pair.ts';
import type { IngestedTrack } from '#types/ingest.ts';
import type { ApiPeer, LabelStatePage } from '#types/peer.ts';
import { type PeerConfig } from './config.ts';
import { type PeerContext } from './context.ts';
import { type ResolveUrl } from './resolver.ts';
export interface IdentityView {
    readonly key_pair: KeyPair;
    readonly identity_address: string;
    readonly own_address: string;
    readonly listens_address: string;
    readonly labels_address: string;
}
export interface Peer extends ApiPeer {
    readonly config: PeerConfig;
    readonly content_store: ContentStore;
    readonly db: DatabaseSync;
    readonly identity: () => IdentityView;
    readonly ingest_file: (file_path: string) => Promise<IngestedTrack>;
    readonly list_library_labels: (input: {
        address: string;
        offset?: number;
        limit?: number;
    }) => Promise<LabelStatePage>;
    readonly context: PeerContext;
}
export interface CreatePeerOptions {
    config?: Partial<PeerConfig>;
    resolve?: ResolveUrl;
    download?: Download;
    network?: (input: {
        content_store: ContentStore;
    }) => Network;
}
export declare const create_peer: ({ config: overrides, resolve, download, network: join_network }?: CreatePeerOptions) => Promise<Peer>;
export declare const start_peer: (peer: Peer) => Promise<void>;
export declare const stop_peer: (peer: Peer) => Promise<void>;
