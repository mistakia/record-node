import { type PeerConfig } from '#peer/config.ts';
export declare const DEFAULT_PORT = 3000;
export declare const DEFAULT_HOST = "127.0.0.1";
export declare const default_data_dir: () => string;
export interface RemoteListener {
    readonly host: string;
    readonly port: number;
}
export interface NodeConfig {
    readonly port: number;
    readonly host: string;
    readonly cors_origins?: readonly string[] | undefined;
    readonly remote_listener?: RemoteListener | undefined;
    readonly peer: PeerConfig;
}
export declare const load_config: ({ config_path, port, data_dir, env }?: {
    config_path?: string | undefined;
    port?: string | number | undefined;
    data_dir?: string | undefined;
    env?: Record<string, string | undefined>;
}) => Promise<NodeConfig>;
