import type { DatabaseSync } from 'node:sqlite';
import type { ContentStore } from '#fabric/content-store.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import type { Download } from '#ingest/download.ts';
import type { TrackTarget } from '#ingest/put-track.ts';
import type { Toolchain } from '#ingest/toolchain.ts';
import type { IngestedTrack } from '#types/ingest.ts';
import type { PeerConfig } from './config.ts';
import type { EventBus } from './events.ts';
import type { LibraryManager } from './library.ts';
import type { PeerReplication } from './replication.ts';
import type { ResolveUrl } from './resolver.ts';
import type { PeerStore } from './store.ts';
export interface PeerIdentity {
    readonly key_pair: KeyPair;
    readonly own_address: string;
    readonly listens_address: string;
}
export interface PeerContext {
    readonly config: PeerConfig;
    readonly store: PeerStore;
    readonly content_store: ContentStore;
    readonly db: DatabaseSync;
    readonly libraries: LibraryManager;
    readonly events: EventBus;
    readonly resolve: ResolveUrl;
    readonly download: Download;
    replication: PeerReplication | undefined;
    identity: PeerIdentity | undefined;
    toolchain: Promise<Toolchain> | undefined;
    writes: Promise<unknown>;
    ingests: Promise<unknown>;
    stopping: boolean;
}
export declare const require_identity: (context: PeerContext) => PeerIdentity;
export declare const serialise_write: <T>(context: PeerContext, job: () => Promise<T>) => Promise<T>;
export declare const drain_queues: (context: PeerContext) => Promise<void>;
export declare const require_toolchain: (context: PeerContext) => Promise<Toolchain>;
export declare const linked_addresses: (context: PeerContext) => string[];
export declare const visible_addresses: (context: PeerContext) => string[];
export declare const ingest_into_own: (context: PeerContext, run: (target: TrackTarget) => Promise<IngestedTrack>) => Promise<IngestedTrack>;
