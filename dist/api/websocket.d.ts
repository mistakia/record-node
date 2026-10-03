import type { Server } from 'node:http';
import { type WebSocket } from 'ws';
import type { ApiPeer } from '#types/peer.ts';
import { type Authenticate } from './middleware.ts';
export declare const WS_PATH = "/api/ws";
export interface EventBridge {
    clients: Set<WebSocket>;
    close: () => Promise<void>;
}
export declare const attach_event_bridge: ({ http_server, peer, authenticate, cors_origins }: {
    http_server: Server;
    peer: ApiPeer;
    authenticate: Authenticate | undefined;
    cors_origins: readonly string[];
}) => EventBridge;
