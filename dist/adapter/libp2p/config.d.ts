export interface NetworkConfig {
    readonly listen: readonly string[];
    readonly bootstrap: readonly string[];
    readonly mdns: boolean;
    readonly dht: boolean;
}
export declare const DEFAULT_NETWORK_CONFIG: NetworkConfig;
