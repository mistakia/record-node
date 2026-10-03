import { type Server } from 'node:http';
import type { ApiPeer, Resolver } from '#types/peer.ts';
import { type Authenticate } from './middleware.ts';
import { type EventBridge } from './websocket.ts';
export interface ApiServerOptions {
    peer: ApiPeer;
    resolve: Resolver;
    port: number;
    host?: string;
    cors_origins?: readonly string[];
    authenticate?: Authenticate;
    log?: boolean;
    validate_responses?: boolean;
}
export interface ApiServer {
    http_server: Server;
    port: number;
    bridge: EventBridge;
}
export declare const create_api_server: ({ peer, resolve: resolver, port, host, cors_origins, authenticate, log, validate_responses }: ApiServerOptions) => Promise<ApiServer>;
export declare const stop_api_server: ({ http_server, bridge }: ApiServer) => Promise<void>;
