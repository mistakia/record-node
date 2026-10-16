// The WebSocket bridge at /api/ws: relays every peer event to every client
// as { type, payload } JSON (x-websocket-events in 7-http-api.yaml). It holds
// no state beyond the open clients; a reconnecting client reads current
// state over REST. The client offers the subprotocols record and
// bearer.<token>; the upgrade authenticates from the second and selects the
// first, so the token is never echoed back. An offer without record is
// refused, since the node would otherwise select no subprotocol; a client
// offering none, as a loopback client without a token may, is accepted.
import { STATUS_CODES } from 'node:http';
import { WebSocketServer } from 'ws';
import { ApiError, origin_allowed } from "./middleware.js";
export const WS_PATH = '/api/ws';
export const WS_SUBPROTOCOL = 'record';
const TOKEN_SUBPROTOCOL_PREFIX = 'bearer.';
const offered_subprotocols = (req) => (req.headers['sec-websocket-protocol'] ?? '').split(',').map((protocol) => protocol.trim()).filter((protocol) => protocol !== '');
export const subprotocol_token = (req) => offered_subprotocols(req).find((protocol) => protocol.startsWith(TOKEN_SUBPROTOCOL_PREFIX))?.slice(TOKEN_SUBPROTOCOL_PREFIX.length);
// Policy violation (RFC 6455 §7.4.1): the client's token no longer verifies.
const CLOSE_TOKEN_REVOKED = 1008;
const refuse_upgrade = (socket, status) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
};
export const attach_event_bridge = ({ http_server, peer, authenticate, cors_origins }) => {
    const wss = new WebSocketServer({
        noServer: true,
        handleProtocols: (protocols) => protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false
    });
    const clients = new Set();
    const client_tokens = new Map();
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
        const offered = offered_subprotocols(req);
        if (offered.length > 0 && !offered.includes(WS_SUBPROTOCOL)) {
            refuse_upgrade(socket, '400 Bad Request');
            return;
        }
        const token = subprotocol_token(req);
        let authenticated;
        try {
            authenticated = authenticate === undefined || await authenticate(token);
        }
        catch (error) {
            // A verifier fault, such as an unreadable token store, is never a 401.
            if (!(error instanceof ApiError))
                throw error;
            refuse_upgrade(socket, `${error.status} ${STATUS_CODES[error.status] ?? 'Error'}`);
            return;
        }
        if (!authenticated) {
            refuse_upgrade(socket, '401 Unauthorized');
            return;
        }
        wss.handleUpgrade(req, socket, head, (client) => {
            const remove = () => {
                clients.delete(client);
                client_tokens.delete(client);
            };
            clients.add(client);
            client_tokens.set(client, token);
            client.on('close', remove);
            client.on('error', remove);
            // A revalidation that ran between the check above and this callback
            // did not see this client, so check its token once more.
            if (authenticate !== undefined) {
                Promise.resolve(authenticate(token)).then((still) => { if (!still)
                    client.close(CLOSE_TOKEN_REVOKED, 'token revoked'); }, () => { });
            }
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
        revalidate: async () => {
            if (authenticate === undefined)
                return;
            for (const [client, token] of [...client_tokens]) {
                if (!(await authenticate(token)))
                    client.close(CLOSE_TOKEN_REVOKED, 'token revoked');
            }
        },
        close: async () => {
            unsubscribe();
            http_server.off('upgrade', upgrade_listener);
            for (const client of clients)
                client.close(1001, 'server shutting down');
            await new Promise((resolve) => { wss.close(() => { resolve(); }); });
        }
    };
};
