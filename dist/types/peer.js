// The peer surface the HTTP and WebSocket API consumes (src/api/). Peer
// assembly (src/peer/) implements it; the API holds no protocol logic.
export class PeerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'PeerError';
        this.code = code;
    }
}
