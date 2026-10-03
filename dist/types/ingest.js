// Ingest results, ingest errors, and the import progress contract (§6.4).
// The API layer turns import events into the import:* WebSocket events of
// 7-http-api.yaml; the protocol layer owns import_id.
export class IngestError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'IngestError';
        this.code = code;
    }
}
