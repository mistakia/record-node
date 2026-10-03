import { type ResolvedAcChain } from '#access-control/resolve.ts';
import type { ContentStore } from '#fabric/content-store.ts';
import type { KeyPair } from '#identity/key-pair.ts';
import type { VerifiedEntry } from '#oplog/accept.ts';
import { type Oplog } from '#oplog/dag.ts';
import { type MergeResult } from '#oplog/merge.ts';
import type { Projector } from '#query-db/projector.ts';
import type { LibraryType } from '#types/library.ts';
import { type PinSet } from './pins.ts';
import type { HeadsStore } from './state.ts';
export interface LibraryHandle {
    readonly chain: ResolvedAcChain;
    readonly oplog: Oplog;
    readonly pins: PinSet;
    open: boolean;
}
export interface LibraryManager {
    create_library: (input: {
        name: string;
        type: LibraryType;
        write_keys: readonly string[];
    }) => Promise<LibraryHandle>;
    open_library: (library_address: string) => Promise<LibraryHandle>;
    close_library: (library_address: string) => Promise<void>;
    unlink_library: (library_address: string) => Promise<void>;
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
    }) => Promise<void>;
    merge: (input: {
        library_address: string;
        blocks: readonly Uint8Array[];
    }) => Promise<MergeResult>;
    settled: () => Promise<void>;
}
export declare const create_library_manager: ({ content_store, projector, heads_store, on_entries }: {
    content_store: ContentStore;
    projector: Projector;
    heads_store: HeadsStore;
    on_entries?: (input: {
        library_address: string;
        entries: readonly VerifiedEntry[];
    }) => void;
}) => LibraryManager;
