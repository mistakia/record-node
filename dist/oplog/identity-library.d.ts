import type { Oplog } from './dag.ts';
export interface IdentityLibraryState {
    readonly libraries: ReadonlyMap<string, {
        readonly retired: boolean;
    }>;
    readonly links: ReadonlyMap<string, {
        readonly alias: string | undefined;
    }>;
    readonly link_keys: ReadonlySet<string>;
    readonly pins: ReadonlySet<string>;
}
export declare const identity_library_state: (oplog: Oplog) => IdentityLibraryState;
