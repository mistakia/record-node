import type { About as AboutRow, LibrarySummary, TrackRow } from '#query-db/queries.ts';
import type { About, Library, ReplicationStatus, Track } from '#types/peer.ts';
export declare const to_api_track: (row: TrackRow) => Track | undefined;
export declare const to_api_tracks: (rows: readonly TrackRow[]) => Track[];
export declare const to_api_about: (row: AboutRow) => About;
export interface LibraryReplication {
    readonly status: ReplicationStatus;
    readonly is_replicating: boolean;
    readonly peer_ids: string[];
}
export declare const to_api_library: ({ address, summary, about, alias, is_own, is_linked, is_loading, replication }: {
    address: string;
    summary: LibrarySummary;
    about: AboutRow | undefined;
    alias: string | null;
    is_own: boolean;
    is_linked: boolean;
    is_loading: boolean;
    replication: LibraryReplication;
}) => Library;
