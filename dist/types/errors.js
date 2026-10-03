// Identifiable protocol errors. Callers branch on `code`, never on message text.
export class ProtocolError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'ProtocolError';
        this.code = code;
    }
}
