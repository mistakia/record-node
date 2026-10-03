import type { About as AboutRow, LibrarySummary, TrackRow } from '#query-db/queries.ts';
import type { About, Library, ReplicationMode, ReplicationStatus, Track } from '#types/peer.ts';
export declare const to_api_track: (row: TrackRow, pins: ReadonlySet<string>) => Track | undefined;
export declare const to_api_tracks: (rows: readonly TrackRow[], pins: ReadonlySet<string>) => Track[];
export declare const to_api_about: (row: AboutRow) => About;
export interface LibraryReplication {
    readonly status: ReplicationStatus;
    readonly is_replicating: boolean;
    readonly connected: boolean;
    readonly peer_ids: string[];
}
export declare const to_api_library: ({ address, library_type, heads, summary, about, alias, is_own, is_retired, is_linked, held_capability_ids, replication_mode, is_loading, replication }: {
    address: string;
    library_type: string;
    heads: readonly string[];
    summary: LibrarySummary;
    about: AboutRow | undefined;
    alias: string | null;
    is_own: boolean;
    is_retired: boolean;
    is_linked: boolean;
    held_capability_ids: string[];
    replication_mode: ReplicationMode | null;
    is_loading: boolean;
    replication: LibraryReplication;
}) => Library;
