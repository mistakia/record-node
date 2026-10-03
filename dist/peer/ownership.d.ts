import { type IdentityLibraryState } from '#oplog/identity-library.ts';
import type { LibraryType } from '#types/library.ts';
import { type PeerContext } from './context.ts';
export declare const OWN_LIBRARY_NAME = "record";
export declare const LISTENS_LIBRARY_NAME = "listens";
export interface OwnLibrary {
    readonly address: string;
    readonly type: LibraryType;
    readonly name: string;
    readonly retired: boolean;
}
export interface Link {
    readonly address: string;
    readonly alias: string | null;
    readonly source: 'identity' | 'legacy';
}
export declare const identity_state: (context: PeerContext) => IdentityLibraryState;
export declare const own_libraries: (context: PeerContext) => OwnLibrary[];
export declare const find_own_library: (context: PeerContext, address: string) => OwnLibrary | undefined;
export declare const active_own_libraries: (context: PeerContext, type: LibraryType) => OwnLibrary[];
export declare const default_write_target: (context: PeerContext) => string | undefined;
export declare const default_own_library: (context: PeerContext) => string | undefined;
export declare const listens_library: (context: PeerContext) => string | undefined;
export declare const link_set: (context: PeerContext) => Link[];
export declare const linked_addresses: (context: PeerContext) => string[];
export declare const visible_addresses: (context: PeerContext) => string[];
export declare const own_recordstore_addresses: (context: PeerContext) => string[];
