export declare const TOOL_PINS: Readonly<{
    ffmpeg_version: "7.1.1";
    fpcalc_version: "1.5.1";
    fpcalc_algorithm: 2;
}>;
export interface PeerConfig {
    readonly data_dir?: string | undefined;
    readonly ffmpeg_path: string;
    readonly fpcalc_path: string;
    readonly ytdlp_path?: string | undefined;
    readonly allow_toolchain_mismatch: boolean;
    readonly traversal_concurrency: number;
    readonly traversal_timeout_ms: number;
    readonly heads_interval_ms: number;
    readonly announce_interval_ms: number;
}
export declare const DEFAULT_PEER_CONFIG: PeerConfig;
export declare const resolve_peer_config: (config?: Partial<PeerConfig>) => PeerConfig;
export declare const data_paths: (data_dir: string) => {
    blocks: string;
    datastore: string;
    identity: string;
    libraries: string;
};
