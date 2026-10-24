import type { ProfileRecord } from '#types/entry.ts';
import type { VerifiedEntry } from './accept.ts';
import type { Oplog } from './dag.ts';
export interface IdentityLibraryState {
    readonly libraries: ReadonlyMap<string, {
        readonly retired: boolean;
        readonly first_put: VerifiedEntry;
    }>;
    readonly links: ReadonlyMap<string, {
        readonly alias: string | undefined;
    }>;
    readonly pins: ReadonlySet<string>;
    readonly profile: ProfileRecord | undefined;
}
export declare const least_entry: <T extends VerifiedEntry>(entries: readonly T[]) => T | undefined;
export declare const identity_library_state: (oplog: Oplog) => IdentityLibraryState;
