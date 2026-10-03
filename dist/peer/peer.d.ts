import type { DatabaseSync } from 'node:sqlite';
import type { ContentStore } from '#fabric/content-store.ts';
import { type Download } from '#ingest/download.ts';
import type { IngestedTrack } from '#types/ingest.ts';
import type { ApiPeer } from '#types/peer.ts';
import { type PeerConfig } from './config.ts';
import { type PeerContext, type PeerIdentity } from './context.ts';
import { type ResolveUrl } from './resolver.ts';
export declare const OWN_LIBRARY_NAME = "record";
export interface Peer extends ApiPeer {
    readonly config: PeerConfig;
    readonly content_store: ContentStore;
    readonly db: DatabaseSync;
    readonly identity: () => PeerIdentity;
    readonly ingest_file: (file_path: string) => Promise<IngestedTrack>;
    readonly context: PeerContext;
}
export interface CreatePeerOptions {
    config?: Partial<PeerConfig>;
    resolve?: ResolveUrl;
    download?: Download;
}
export declare const create_peer: ({ config: overrides, resolve, download }?: CreatePeerOptions) => Promise<Peer>;
export declare const start_peer: (peer: Peer) => Promise<void>;
export declare const stop_peer: (peer: Peer) => Promise<void>;
