export declare const NETWORK_MODES: readonly ["public", "masked", "relayed"];
export type NetworkMode = typeof NETWORK_MODES[number];
export interface MainlineRendezvousConfig {
    readonly dht_bootstrap?: readonly string[] | undefined;
    readonly port: number;
    readonly lookup_interval_ms: number;
    readonly dial_private: boolean;
}
export interface RelayServerConfig {
    readonly allowed_peer_ids: readonly string[];
}
export interface TorConfig {
    readonly socks_address: string;
}
export interface NetworkConfig {
    readonly mode: NetworkMode;
    readonly listen: readonly string[];
    readonly announce_addresses: readonly string[];
    readonly bootstrap: readonly string[];
    readonly mdns: boolean;
    readonly dht: boolean;
    readonly upnp: boolean;
    readonly mainline_rendezvous: MainlineRendezvousConfig | false;
    readonly relay_server: RelayServerConfig | false;
    readonly relay_address?: string | undefined;
    readonly tor?: TorConfig | undefined;
}
export declare const RENDEZVOUS_NAME = "record-network-v1";
export declare const DEFAULT_MAINLINE_RENDEZVOUS: MainlineRendezvousConfig;
export declare const VPS_PEER_ID = "12D3KooWQLvRR8WUAsgQWaduVRtSwKTheBtGCnNtm9QF1ZNvFvy5";
export declare const DEFAULT_MASKED_BOOTSTRAP: readonly string[];
export declare const DEFAULT_NETWORK_CONFIG: NetworkConfig;
export declare const parse_host_port: (value: string) => {
    host: string;
    port: number;
} | undefined;
export declare const resolve_network_config: (network: unknown) => NetworkConfig | false;
