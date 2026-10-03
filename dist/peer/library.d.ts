import { type ResolvedAcChain } from '#access-control/resolve.ts';
import type { ContentStore } from '#fabric/content-store.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import { type AccessChange, type Oplog } from '#oplog/dag.ts';
import { type MergeResult } from '#oplog/merge.ts';
import type { Projector } from '#query-db/projector.ts';
import type { LibraryType } from '#types/library.ts';
import { type KeepsBlobs, type PinSet } from './pins.ts';
import type { LibraryStateStore, StoredPolicy } from './state.ts';
export interface LibraryHandle {
    readonly chain: ResolvedAcChain;
    readonly oplog: Oplog;
    readonly pins: PinSet;
}
export interface LibraryManager {
    create_library: (input: {
        name: string;
        type: LibraryType;
        write_keys: readonly string[];
    }) => Promise<LibraryHandle>;
    open_library: (library_address: string) => Promise<LibraryHandle>;
    begin_unlink: (library_address: string) => Promise<void>;
    unlink_library: (library_address: string) => Promise<void>;
    pending_unlinks: () => Promise<string[]>;
    load_policies: () => Promise<ReadonlyMap<string, StoredPolicy>>;
    save_policy: (input: {
        library_address: string;
        policy: StoredPolicy | undefined;
    }) => Promise<void>;
    get: (library_address: string) => LibraryHandle | undefined;
    list: () => LibraryHandle[];
    append: (input: {
        library_address: string;
        payload: unknown;
        key_pair: KeyPair;
    }) => Promise<VerifiedEntry>;
    register: (input: {
        library_address: string;
        entries: readonly VerifiedEntry[];
        access?: AccessChange;
    }) => Promise<void>;
    merge: (input: {
        library_address: string;
        blocks: readonly Uint8Array[];
    }) => Promise<MergeResult>;
    reindex: (input: {
        library_address: string;
        entries: readonly VerifiedEntry[];
    }) => Promise<void>;
    hold_blobs: (input: {
        library_address: string;
        cids: readonly string[];
    }) => Promise<void>;
    release_blobs: (input: {
        library_address: string;
        cids: readonly string[];
    }) => Promise<void>;
    settled: () => Promise<void>;
}
export declare const create_library_manager: ({ content_store, projector, state_store, on_entries, keeps_blobs, retained }: {
    content_store: ContentStore;
    projector: Projector;
    state_store: LibraryStateStore;
    keeps_blobs?: (chain: ResolvedAcChain) => KeepsBlobs;
    retained?: () => ReadonlySet<string>;
    on_entries?: (input: {
        library_address: string;
        entries: readonly VerifiedEntry[];
        inert: readonly VerifiedEntry[];
    }) => void;
}) => LibraryManager;
