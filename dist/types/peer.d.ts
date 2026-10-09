import type { ImportEventPayloads } from './ingest.ts';
export interface ResolverEntry {
    extractor: string;
    id: string;
    fulltitle?: string;
    thumbnail?: string;
    artist?: string;
    alt_title?: string;
    upload_date?: string;
    webpage_url?: string;
    duration?: number;
}
export interface TrackTag {
    library_address: string;
    tag: string;
}
export interface Track {
    id: string;
    library_addresses: string[];
    content_cid: string;
    audio_cid: string;
    audio_size_bytes: number;
    title?: string | null;
    artist?: string | null;
    artists?: string[];
    album?: string | null;
    album_artist?: string | null;
    remixer?: string | null;
    genre?: string[];
    bpm?: number | null;
    duration_seconds?: number | null;
    bitrate?: number | null;
    codec?: string | null;
    sample_rate?: number | null;
    lossless?: boolean | null;
    artwork?: string[];
    resolvers?: ResolverEntry[];
    tags: TrackTag[];
    listen_count: number;
    listen_timestamps_ms?: number[];
    have_track: boolean;
    is_pinned: boolean;
    added_at_ms?: number;
}
export interface TrackList {
    items: Track[];
    total: number;
}
export interface TagCount {
    tag: string;
    count: number;
}
export interface ReplicationStatus {
    progress: number;
    total: number;
}
export type ReplicationMode = 'full' | 'selective' | 'index_only';
export type SpecNode = {
    type: string;
} & Record<string, unknown>;
export interface ReplicationPolicy {
    mode: ReplicationMode;
    filter: SpecNode | null;
    connected: boolean;
}
export interface Library {
    id: string;
    address: string;
    library_type: string;
    name?: string | null;
    bio?: string | null;
    location?: string | null;
    avatar?: string | null;
    alias?: string | null;
    track_count: number;
    audio_size_bytes: number;
    linked_library_count: number;
    length: number;
    heads: string[];
    replication_status: ReplicationStatus;
    is_replicating: boolean;
    connected: boolean;
    is_loading_index: boolean;
    is_processing_index: boolean;
    is_linked: boolean;
    is_own: boolean;
    is_retired: boolean;
    held_capability_ids: string[];
    replication_mode?: ReplicationMode | null;
    peer_ids: string[];
}
export type CapabilityStatus = 'active' | 'expired' | 'revoked' | 'inert';
export interface Capability {
    capability_id: string;
    library_address: string;
    issuer: string;
    via_capability_id?: string | null;
    grantee: SpecNode;
    actions: string[];
    filter: SpecNode | null;
    conditions: SpecNode[];
    issued_at_ms: number;
    expires_at_ms?: number | null;
    status: CapabilityStatus;
    revoked_by?: string | null;
}
export interface MetaLogRecord {
    entry_hash: string;
    op: 'PUT' | 'DEL';
    type: string;
    key: string;
    record: Record<string, unknown>;
    clock_time: number;
    timestamp_ms: number;
    is_current: boolean;
}
export interface MetaLogPage {
    address: string;
    heads: string[];
    items: MetaLogRecord[];
    total: number;
}
export interface About {
    library_address: string;
    name?: string | null;
    bio?: string | null;
    location?: string | null;
    avatar?: string | null;
}
export type AboutUpdate = Partial<Omit<About, 'library_address'>>;
export interface ListenCount {
    track_id: string;
    count: number;
    timestamps_ms?: number[];
}
export interface PeerInfo {
    peer_id: string;
    multiaddrs: string[];
    library_addresses?: string[];
    connected_at_ms?: number;
}
export interface NetworkCensusRow {
    readonly date: string;
    readonly complete: boolean;
    readonly distinct_peer_count: number;
    readonly peak_connection_count: number;
    readonly median_connection_count: number;
    readonly masked_peer_count: number;
    readonly announced_library_count: number;
    readonly node_version_counts: Readonly<Record<string, number>>;
    readonly rendezvous_address_count: number | null;
    readonly weekly_distinct_peer_count?: number;
}
export interface Settings {
    peer_id: string;
    addresses?: string[];
    version?: string;
    network_mode?: 'public' | 'masked' | 'relayed';
    bandwidth?: {
        total_in_bytes?: string;
        total_out_bytes?: string;
        rate_in_bytes_per_sec?: string;
        rate_out_bytes_per_sec?: string;
    };
    storage?: {
        used_bytes?: number;
        max_bytes?: number;
        object_count?: number;
    };
}
export interface Identity {
    public_key: string;
    meta_log_address: string;
    own_library_address: string;
}
export interface IdentityExport {
    public_key: string;
    private_key: string;
}
export interface ImportedIdentity {
    id: string;
    public_key: string;
    own_library_address: string;
    meta_log_address: string;
}
export interface WriteTargetInput {
    library_address?: string | undefined;
    capability_id?: string | undefined;
}
export type TrackSort = 'title' | 'artist' | 'album' | 'bpm' | 'duration' | 'added_at';
export interface TrackQuery {
    offset: number;
    limit: number;
    library_addresses?: string[];
    tags?: string[];
    query?: string;
    shuffle: boolean;
    sort: TrackSort;
    order: 'asc' | 'desc';
}
export interface ImportAck {
    import_id: string;
    file_count?: number;
}
export type ImportEvent = {
    type: 'import:starting';
    payload: ImportEventPayloads['import:starting'];
} | {
    type: 'import:processed-file';
    payload: {
        import_id: string;
        file_path: string;
        track: Track;
        completed: number;
        remaining: number;
    };
} | {
    type: 'import:error';
    payload: {
        import_id: string;
        file_path: string;
        error: {
            error: {
                code: string;
                message: string;
            };
        };
    };
} | {
    type: 'import:finished';
    payload: ImportEventPayloads['import:finished'];
};
export type LibraryEventType = 'track:added' | 'track:removed' | 'track:pinned' | 'track:unpinned' | 'library:linked' | 'library:unlinked' | 'library:entries-inert' | 'library:replication-policy-changed' | 'identity:library-created' | 'identity:library-retired' | 'identity:meta-log-appended' | 'capability:issued' | 'capability:revoked' | 'library:connected' | 'library:disconnected' | 'library:loading' | 'library:loaded' | 'library:replicated' | 'library:replicate-progress' | 'library:index-updated' | 'library:peer-joined' | 'library:peer-left' | 'peer:joined' | 'peer:left';
export type PeerEvent = ImportEvent | {
    type: LibraryEventType;
    payload: Record<string, unknown>;
};
export type PeerErrorCode = 'not_found' | 'conflict' | 'forbidden' | 'capability_expired' | 'capability_revoked' | 'invalid';
export declare class PeerError extends Error {
    readonly code: PeerErrorCode;
    constructor(code: PeerErrorCode, message: string);
}
export interface ApiPeer {
    list_tracks: (query: TrackQuery) => Promise<TrackList>;
    add_track: (input: {
        content_cid: string;
    } & WriteTargetInput) => Promise<Track>;
    update_track: (input: {
        track_id: string;
        tags: Readonly<Record<string, unknown>>;
    } & WriteTargetInput) => Promise<Track>;
    rederive_track: (input: {
        track_id: string;
    } & WriteTargetInput) => Promise<Track>;
    remove_track: (input: {
        track_id: string;
        library_address?: string | undefined;
    }) => Promise<void>;
    pin_track: (cid: string) => Promise<void>;
    unpin_track: (cid: string) => Promise<void>;
    list_tags: (filter: {
        library_addresses?: string[];
    }) => Promise<TagCount[]>;
    add_tag: (label: {
        track_id: string;
        tag: string;
    } & WriteTargetInput) => Promise<Track>;
    remove_tag: (label: {
        track_id: string;
        tag: string;
    } & WriteTargetInput) => Promise<Track>;
    list_libraries: () => Promise<Library[]>;
    get_library: (address: string) => Promise<Library | undefined>;
    link_library: (link: {
        address: string;
        alias: string | null;
    }) => Promise<Library>;
    unlink_library: (address: string) => Promise<void>;
    connect_library: (address: string) => Promise<void>;
    disconnect_library: (address: string) => Promise<void>;
    get_replication_policy: (address: string) => Promise<ReplicationPolicy>;
    set_replication_policy: (input: {
        address: string;
        mode: ReplicationMode;
        filter?: unknown;
    }) => Promise<ReplicationPolicy>;
    list_capabilities: (address: string) => Promise<Capability[]>;
    issue_capability: (input: {
        library_address: string;
        grantee: unknown;
        actions: string[];
        filter?: unknown;
        conditions?: unknown[] | undefined;
        capability_id?: string | undefined;
    }) => Promise<Capability>;
    revoke_capability: (input: {
        library_address: string;
        capability_id: string;
        via_capability_id?: string | undefined;
    }) => Promise<void>;
    get_about: (address: string) => Promise<About | undefined>;
    set_about: (update: {
        address: string;
        fields: AboutUpdate;
        capability_id?: string | undefined;
    }) => Promise<About>;
    list_listens: (page: {
        offset: number;
        limit: number;
    }) => Promise<TrackList>;
    record_listen: (listen: {
        track_id: string;
        library_address: string;
    }) => Promise<ListenCount>;
    list_peers: () => Promise<PeerInfo[]>;
    get_settings: () => Promise<Settings>;
    get_network_census: (date?: string) => Promise<NetworkCensusRow | undefined>;
    get_identity: () => Promise<Identity>;
    export_identity: () => Promise<IdentityExport>;
    import_identity: (key: {
        private_key?: string;
    }) => Promise<ImportedIdentity>;
    list_own_libraries: () => Promise<Library[]>;
    create_own_library: (input: {
        discriminator?: string | undefined;
        about?: AboutUpdate | undefined;
    }) => Promise<Library>;
    retire_own_library: (address: string) => Promise<void>;
    list_held_capabilities: () => Promise<Capability[]>;
    read_meta_log: (query: {
        offset: number;
        limit: number;
        type?: string | undefined;
        current_only: boolean;
    }) => Promise<MetaLogPage>;
    get_audio: (cid: string) => Promise<Uint8Array | undefined>;
    has_audio: (cid: string) => Promise<boolean>;
    get_image: (cid: string, options?: {
        local_only?: boolean;
    }) => Promise<Uint8Array | undefined>;
    import_files: (input: {
        paths: string[];
    } & WriteTargetInput) => Promise<ImportAck>;
    import_url: (input: {
        url: string;
    } & WriteTargetInput) => Promise<ImportAck>;
    subscribe: (handler: (event: PeerEvent) => void) => () => void;
}
export type Resolver = (url: string) => Promise<ReadonlyArray<Record<string, unknown>>>;
