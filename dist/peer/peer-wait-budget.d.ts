import type { Network } from '#fabric/network.ts';
export declare const create_peer_wait_budget: ({ network, timeout_ms, closed }: {
    network: Pick<Network, "fetch_block">;
    timeout_ms: number;
    closed?: AbortSignal | undefined;
}) => (cid: string) => Promise<Uint8Array | undefined>;
