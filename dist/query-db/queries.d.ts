import type { DatabaseSync } from 'node:sqlite';
export declare const TRACK_SORTS: readonly ["title", "artist", "album", "bpm", "duration", "added_at"];
export type TrackSort = typeof TRACK_SORTS[number];
export type SortOrder = 'asc' | 'desc';
export declare const DEFAULT_LIMIT = 100;
export declare const MAX_LIMIT = 500;
export interface TrackTag {
    readonly library_address: string;
    readonly tag: string;
}
export interface TrackResolver {
    readonly extractor: string;
    readonly id: string;
    readonly fulltitle?: string;
    readonly thumbnail?: string;
    readonly artist?: string;
    readonly alt_title?: string;
    readonly upload_date?: string;
    readonly webpage_url?: string;
    readonly duration_seconds?: number;
}
export interface TrackRow {
    readonly id: string;
    readonly library_address: string;
    readonly content_cid: string;
    readonly audio_cid: string | null;
    readonly audio_size_bytes: number | null;
    readonly title: string | null;
    readonly artist: string | null;
    readonly artists: string[];
    readonly album: string | null;
    readonly album_artist: string | null;
    readonly remixer: string | null;
    readonly genre: string[];
    readonly bpm: number | null;
    readonly duration_seconds: number | null;
    readonly bitrate: number | null;
    readonly codec: string | null;
    readonly sample_rate: number | null;
    readonly lossless: boolean | null;
    readonly artwork: string[];
    readonly resolvers: TrackResolver[];
    readonly tags: TrackTag[];
    readonly listen_count: number;
    readonly listen_timestamps_ms?: number[];
    readonly have_track: boolean;
    readonly added_at_ms: number;
}
export interface Page<T> {
    readonly items: T[];
    readonly total: number;
}
export interface TagCount {
    readonly tag: string;
    readonly count: number;
}
export interface ListenCount {
    readonly track_id: string;
    readonly count: number;
    readonly timestamps_ms: number[];
}
export interface ListenHistoryItem extends ListenCount {
    readonly last_listened_at_ms: number;
    readonly track?: TrackRow;
}
export interface LinkedLibrary {
    readonly address: string;
    readonly alias: string | null;
}
export interface LibrarySummary {
    readonly track_count: number;
    readonly linked_library_count: number;
    readonly length: number;
}
export interface About {
    readonly library_address: string;
    readonly name: string | null;
    readonly bio: string | null;
    readonly location: string | null;
    readonly avatar: string | null;
}
export interface ListTracksInput {
    readonly own_library_addresses?: readonly string[] | undefined;
    readonly library_addresses?: readonly string[] | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly query?: string | undefined;
    readonly shuffle?: boolean | undefined;
    readonly sort?: TrackSort | undefined;
    readonly order?: SortOrder | undefined;
    readonly offset?: number | undefined;
    readonly limit?: number | undefined;
}
export declare const list_tracks: ({ db, ...input }: {
    db: DatabaseSync;
} & ListTracksInput) => Page<TrackRow>;
export declare const get_track: ({ db, track_id, own_library_addresses, library_addresses }: {
    db: DatabaseSync;
    track_id: string;
    own_library_addresses?: readonly string[];
    library_addresses?: readonly string[];
}) => TrackRow | undefined;
export declare const list_tags: ({ db, library_addresses }: {
    db: DatabaseSync;
    library_addresses?: readonly string[];
}) => TagCount[];
export declare const get_listen_count: ({ db, track_id, listens_addresses }: {
    db: DatabaseSync;
    track_id: string;
    listens_addresses?: readonly string[];
}) => ListenCount;
export declare const list_listens: ({ db, own_library_addresses, listens_addresses, offset, limit }: {
    db: DatabaseSync;
    own_library_addresses?: readonly string[];
    listens_addresses?: readonly string[];
    offset?: number;
    limit?: number;
}) => Page<ListenHistoryItem>;
export declare const list_linked_libraries: ({ db, library_address }: {
    db: DatabaseSync;
    library_address: string;
}) => LinkedLibrary[];
export declare const get_library_summary: ({ db, library_address }: {
    db: DatabaseSync;
    library_address: string;
}) => LibrarySummary;
export declare const get_about: ({ db, library_address }: {
    db: DatabaseSync;
    library_address: string;
}) => About | undefined;
export declare const find_track_by_source: ({ db, library_address, extractor, id }: {
    db: DatabaseSync;
    library_address: string;
    extractor: string;
    id: string;
}) => string | undefined;
