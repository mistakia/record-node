export declare const SERVICE_TYPE = "_record-api._tcp.local";
export declare const start_local_network_advertisement: ({ node_url, peer_id, host_name, port }: {
    node_url: string;
    peer_id: string;
    host_name?: string;
    port?: number;
}) => Promise<() => Promise<void>>;
