// Request middleware and the error envelope. Every non-2xx body is
// { error: { code, message, details? } } with a code from the spec's enum.
import { PeerError } from '#types/peer.ts';
import { ProtocolError } from '#types/errors.ts';
export class ApiError extends Error {
    status;
    code;
    details;
    constructor({ status, code, message, details }) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
// The known-client default allowlist, used when the operator configures none
// (spec §8.7.5). It is empty at v1: the desktop application calls the node
// from its main process, which sends no Origin.
export const KNOWN_CLIENT_ORIGINS = Object.freeze([]);
// Whether a request's Origin may use the API: only those listed, and never
// the opaque origin `null`. A request with no Origin is not from a browser
// page and always passes.
export const origin_allowed = (cors_origins, origin) => origin === undefined || (origin !== 'null' && cors_origins.includes(origin));
// Echo an allowed Origin and allow credentials. A request from any other
// origin is refused outright, not just left without CORS headers: the headers
// only stop a page reading the response, and a simple request such as a
// multipart upload takes effect without a preflight.
export const cors = (cors_origins) => (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin_allowed(cors_origins, origin)) {
        next(new ApiError({ status: 403, code: 'FORBIDDEN', message: `origin not allowed: ${String(origin)}` }));
        return;
    }
    if (origin !== undefined) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
        res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
};
export const no_cache = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    next();
};
export const bearer_token = (header) => {
    const match = /^Bearer (.+)$/.exec(header ?? '');
    return match?.[1];
};
export const authenticate_requests = (authenticate) => async (req, _res, next) => {
    if (authenticate === undefined || await authenticate(bearer_token(req.headers.authorization))) {
        next();
        return;
    }
    next(new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'a valid bearer token is required' }));
};
const send_error = (res, { status, code, message, details }) => {
    res.status(status).json({ error: details === undefined ? { code, message } : { code, message, details } });
};
const PEER_ERRORS = {
    not_found: { status: 404, code: 'NOT_FOUND' },
    conflict: { status: 409, code: 'CONFLICT' },
    forbidden: { status: 403, code: 'FORBIDDEN' },
    invalid: { status: 400, code: 'VALIDATION_ERROR' }
};
const is_validator_error = (error) => error instanceof Error && typeof error.status === 'number';
const validator_code = (status) => {
    if (status === 401)
        return 'UNAUTHORIZED';
    if (status === 404 || status === 405)
        return 'NOT_FOUND';
    if (status >= 500)
        return 'INTERNAL_ERROR';
    return 'VALIDATION_ERROR';
};
export const handle_errors = (log_error) => (error, _req, res, _next) => {
    if (error instanceof ApiError) {
        send_error(res, error);
    }
    else if (error instanceof PeerError) {
        send_error(res, { ...PEER_ERRORS[error.code], message: error.message });
    }
    else if (error instanceof ProtocolError) {
        send_error(res, { status: 400, code: 'VALIDATION_ERROR', message: error.message, details: [{ field: error.code, message: error.message }] });
    }
    else if (is_validator_error(error)) {
        if (error.status >= 500)
            log_error(error);
        const details = (error.errors ?? []).map(({ path, message }) => ({ field: path ?? '', message: message ?? '' }));
        send_error(res, { status: error.status, code: validator_code(error.status), message: error.message, details });
    }
    else {
        log_error(error);
        send_error(res, { status: 500, code: 'INTERNAL_ERROR', message: 'internal error' });
    }
};
