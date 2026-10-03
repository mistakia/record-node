// The WebSocket bridge at /api/ws: relays every peer event to every client
// as { type, payload } JSON (x-websocket-events in 7-http-api.yaml). It holds
// no state beyond the open clients; a reconnecting client reads current
// state over REST.
import { WebSocketServer } from 'ws';
import { origin_allowed } from "./middleware.js";
export const WS_PATH = '/api/ws';
const refuse_upgrade = (socket, status) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
};
export const attach_event_bridge = ({ http_server, peer, authenticate, cors_origins }) => {
    const wss = new WebSocketServer({ noServer: true });
    const clients = new Set();
    const on_upgrade = async (req, socket, head) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== WS_PATH) {
            refuse_upgrade(socket, '404 Not Found');
            return;
        }
        // A WebSocket handshake carries no CORS check, so the origin rule is applied here.
        if (!origin_allowed(cors_origins, req.headers.origin)) {
            refuse_upgrade(socket, '403 Forbidden');
            return;
        }
        if (authenticate !== undefined && !(await authenticate(url.searchParams.get('token') ?? undefined))) {
            refuse_upgrade(socket, '401 Unauthorized');
            return;
        }
        wss.handleUpgrade(req, socket, head, (client) => {
            clients.add(client);
            client.on('close', () => { clients.delete(client); });
            client.on('error', () => { clients.delete(client); });
        });
    };
    const upgrade_listener = (req, socket, head) => {
        on_upgrade(req, socket, head).catch(() => { socket.destroy(); });
    };
    http_server.on('upgrade', upgrade_listener);
    const unsubscribe = peer.subscribe((event) => {
        const message = JSON.stringify(event);
        for (const client of clients) {
            if (client.readyState === client.OPEN)
                client.send(message);
        }
    });
    return {
        clients,
        close: async () => {
            unsubscribe();
            http_server.off('upgrade', upgrade_listener);
            for (const client of clients)
                client.close(1001, 'server shutting down');
            await new Promise((resolve) => { wss.close(() => { resolve(); }); });
        }
    };
};
