import type { DatabaseSync } from 'node:sqlite';
import type { CommitBatcher } from '#fabric/commit-batch.ts';
import type { ContentStore } from '#fabric/content-store.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import type { Download } from '#ingest/download.ts';
import type { TrackTarget } from '#ingest/put-track.ts';
import type { Toolchain } from '#ingest/toolchain.ts';
import type { IngestedTrack } from '#types/ingest.ts';
import type { AudioSource } from './audio.ts';
import type { BlobKeeper } from './blobs.ts';
import type { PeerConfig } from './config.ts';
import type { EventBus } from './events.ts';
import type { DataDirectoryLock } from './lock.ts';
import type { LibraryManager } from './library.ts';
import type { Census } from './census.ts';
import type { PeerReplication } from './replication.ts';
import type { ResolveUrl } from './resolver.ts';
import { type WriteTarget } from './write-target.ts';
import type { StoredPolicy } from './state.ts';
import type { PeerStore } from './store.ts';
export interface PeerIdentity {
    readonly key_pair: KeyPair;
    readonly identity_address: string;
}
export interface PeerContext {
    readonly config: PeerConfig;
    readonly store: PeerStore;
    readonly content_store: ContentStore;
    readonly db: DatabaseSync;
    readonly index_commit: CommitBatcher | undefined;
    readonly libraries: LibraryManager;
    readonly events: EventBus;
    readonly resolve: ResolveUrl;
    readonly download: Download;
    readonly audio: AudioSource;
    replication: PeerReplication | undefined;
    census: Census | undefined;
    identity: PeerIdentity | undefined;
    toolchain: Promise<Toolchain> | undefined;
    readonly lock: DataDirectoryLock | undefined;
    writes: Promise<unknown>;
    ingests: Promise<unknown>;
    stopping: boolean;
    known: {
        ready: boolean;
        links: Set<string>;
        libraries: Map<string, boolean>;
    };
    readonly prepares: {
        active: number;
        waiting: Array<() => void>;
        in_flight: Set<Promise<void>>;
    };
    readonly policies: Map<string, StoredPolicy>;
    blobs: BlobKeeper;
}
export declare const require_identity: (context: PeerContext) => PeerIdentity;
export declare const refuse_when_stopping: (context: PeerContext) => void;
export declare const serialise_write: <T>(context: PeerContext, job: () => Promise<T>) => Promise<T>;
export declare const drain_queues: (context: PeerContext) => Promise<void>;
export declare const require_toolchain: (context: PeerContext) => Promise<Toolchain>;
export declare const ingest_into: <P>(context: PeerContext, target: WriteTarget, { prepare, commit, blobs }: {
    prepare: (target: TrackTarget) => Promise<P>;
    commit: (input: {
        target: TrackTarget;
        prepared: P;
        release: (cids: readonly string[]) => Promise<void>;
    }) => Promise<IngestedTrack>;
    blobs: (prepared: P) => readonly string[];
}) => Promise<IngestedTrack>;
