import { type Server } from 'node:http';
import type { ApiPeer, Resolver } from '#types/peer.ts';
import { type Authenticate, type IdentifyToken, type ManagedLabelLibraries } from './middleware.ts';
import { type EventBridge } from './websocket.ts';
export interface ApiServerOptions {
    peer: ApiPeer;
    resolve: Resolver;
    port: number;
    host?: string;
    cors_origins?: readonly string[] | undefined;
    authenticate?: Authenticate;
    identify?: IdentifyToken;
    managed_label_libraries?: ManagedLabelLibraries;
    docs?: boolean;
    log?: boolean;
    validate_responses?: boolean;
}
export interface ApiServer {
    http_server: Server;
    port: number;
    bridge: EventBridge;
}
export declare const create_api_server: ({ peer, resolve: resolver, port, host, cors_origins, authenticate, identify, managed_label_libraries, docs, log, validate_responses }: ApiServerOptions) => Promise<ApiServer>;
export declare const stop_api_server: ({ http_server, bridge }: ApiServer) => Promise<void>;
