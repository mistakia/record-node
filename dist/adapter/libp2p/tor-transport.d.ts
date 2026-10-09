import type { Transport } from '@libp2p/interface';
import { tcp } from '@libp2p/tcp';
import type { Multiaddr } from '@multiformats/multiaddr';
type TcpComponents = Parameters<ReturnType<typeof tcp>>[0];
export declare const socks_destination: (ma: Multiaddr) => {
    host: string;
    port: number;
} | undefined;
export declare const tor_transport: ({ socks_address }: {
    socks_address: string;
}) => (components: TcpComponents) => Transport;
export {};
