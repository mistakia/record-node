// The API server: an Express app serving 7-http-api.yaml under /api, and the
// WebSocket bridge on the same HTTP server. Signal handling belongs to the
// process entry point, which calls stop_api_server.
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { Router } from 'express';
import morgan from 'morgan';
import { IMAGE_MAX_BYTES } from '#peer/images.ts';
import { authenticate_requests, cors, handle_errors, KNOWN_CLIENT_ORIGINS, no_cache, skip_abandoned_reads } from "./middleware.js";
import { create_docs_router, create_validator, load_api_spec, parse_image_upload, parse_uploads } from "./openapi.js";
import { attach_event_bridge } from "./websocket.js";
import { audio_router } from "./routes/audio.js";
import { identity_router } from "./routes/identity.js";
import { images_router } from "./routes/images.js";
import { import_router } from "./routes/import.js";
import { libraries_router } from "./routes/libraries.js";
import { listens_router } from "./routes/listens.js";
import { network_census_router } from "./routes/network-census.js";
import { peers_router } from "./routes/peers.js";
import { resolve_router } from "./routes/resolve.js";
import { settings_router } from "./routes/settings.js";
import { tags_router } from "./routes/tags.js";
import { tracks_router } from "./routes/tracks.js";
const DRAIN_TIMEOUT_MS = 5000;
// Uploads wait here for ingest, which removes each file when done with it, so
// the directory outlives any one server.
const UPLOAD_DIR = join(tmpdir(), 'record-node-uploads');
export const create_api_server = async ({ peer, resolve: resolver, port, host = '127.0.0.1', cors_origins = KNOWN_CLIENT_ORIGINS, authenticate, log = true, validate_responses = false }) => {
    const spec = load_api_spec();
    await mkdir(UPLOAD_DIR, { recursive: true });
    const api = Router();
    api.use('/docs', create_docs_router(spec));
    api.use(authenticate_requests(authenticate));
    api.use(express.json());
    api.post('/import/file', parse_uploads(UPLOAD_DIR));
    api.post('/images', parse_image_upload(IMAGE_MAX_BYTES));
    // Off-spec, so ahead of the validator.
    api.use('/network-census', network_census_router(peer));
    api.use(create_validator({ spec, validate_responses }));
    api.use('/tracks', tracks_router(peer));
    api.use('/tags', tags_router(peer));
    api.use('/libraries', libraries_router(peer));
    api.use('/listens', listens_router(peer));
    api.use('/peers', peers_router(peer));
    api.use('/settings', settings_router(peer));
    api.use('/identity', identity_router(peer));
    api.use('/import', import_router(peer));
    api.use('/audio', audio_router(peer));
    api.use('/images', images_router(peer));
    api.use('/resolve', resolve_router(resolver));
    const app = express();
    app.disable('x-powered-by');
    if (log)
        app.use(morgan('dev'));
    app.use(cors(cors_origins));
    app.use('/api', no_cache, skip_abandoned_reads, api);
    app.use(handle_errors((error) => { console.error(error); }));
    const http_server = createServer(app);
    const bridge = attach_event_bridge({ http_server, peer, authenticate, cors_origins });
    try {
        await new Promise((resolve, reject) => {
            http_server.once('error', reject);
            http_server.listen(port, host, () => { resolve(); });
        });
    }
    catch (error) {
        await bridge.close();
        throw error;
    }
    return { http_server, port: http_server.address().port, bridge };
};
// Close the WebSocket clients, stop accepting connections, give in-flight
// requests DRAIN_TIMEOUT_MS, then cut what remains.
export const stop_api_server = async ({ http_server, bridge }) => {
    await bridge.close();
    const closed = new Promise((resolve) => { http_server.close(() => { resolve(); }); });
    http_server.closeIdleConnections();
    const timer = setTimeout(() => { http_server.closeAllConnections(); }, DRAIN_TIMEOUT_MS);
    await closed;
    clearTimeout(timer);
};
