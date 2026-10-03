import type { About as AboutRow, LibrarySummary, TrackRow } from '#query-db/queries.ts';
import type { About, Library, Track } from '#types/peer.ts';
export declare const to_api_track: (row: TrackRow) => Track | undefined;
export declare const to_api_tracks: (rows: readonly TrackRow[]) => Track[];
export declare const to_api_about: (row: AboutRow) => About;
export declare const to_api_library: ({ address, summary, about, alias, is_own, is_linked, is_loading }: {
    address: string;
    summary: LibrarySummary;
    about: AboutRow | undefined;
    alias: string | null;
    is_own: boolean;
    is_linked: boolean;
    is_loading: boolean;
}) => Library;
