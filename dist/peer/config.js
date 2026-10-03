// Peer configuration: tool paths and pins, protocol tuning floors, and the
// data directory. Every field has a default, so {} is a valid configuration.
import { join } from 'node:path';
import { PINNED_FFMPEG_VERSION, PINNED_FPCALC_VERSION } from '#ingest/toolchain.ts';
// The protocol-bound tool pins (§6.1.5, §6.2.4). The ffmpeg flags and the
// fpcalc algorithm are fixed in src/ingest, not configurable.
export const TOOL_PINS = Object.freeze({
    ffmpeg_version: PINNED_FFMPEG_VERSION,
    fpcalc_version: PINNED_FPCALC_VERSION,
    fpcalc_algorithm: 2
});
export const DEFAULT_PEER_CONFIG = Object.freeze({
    ffmpeg_path: 'ffmpeg',
    fpcalc_path: 'fpcalc',
    allow_toolchain_mismatch: false,
    traversal_concurrency: 4,
    traversal_timeout_ms: 30_000,
    heads_interval_ms: 1000,
    announce_interval_ms: 5000
});
const STRING_FIELDS = ['ffmpeg_path', 'fpcalc_path'];
const OPTIONAL_STRING_FIELDS = ['data_dir', 'ytdlp_path'];
// Checks every value's type, since a config file is untyped JSON: a string
// "false" must never enable allow_toolchain_mismatch.
export const resolve_peer_config = (config = {}) => {
    const resolved = { ...DEFAULT_PEER_CONFIG, ...config };
    for (const field of STRING_FIELDS) {
        if (typeof resolved[field] !== 'string' || resolved[field] === '')
            throw new TypeError(`${field} must be a non-empty string`);
    }
    for (const field of OPTIONAL_STRING_FIELDS) {
        if (resolved[field] !== undefined && typeof resolved[field] !== 'string')
            throw new TypeError(`${field} must be a string`);
    }
    if (typeof resolved.allow_toolchain_mismatch !== 'boolean')
        throw new TypeError('allow_toolchain_mismatch must be true or false');
    for (const field of ['traversal_concurrency', 'traversal_timeout_ms', 'heads_interval_ms', 'announce_interval_ms']) {
        if (!Number.isSafeInteger(resolved[field]) || resolved[field] <= 0) {
            throw new RangeError(`${field} must be a positive integer, not ${String(resolved[field])}`);
        }
    }
    return Object.freeze(resolved);
};
// The data directory layout.
export const data_paths = (data_dir) => ({
    blocks: join(data_dir, 'blocks'),
    datastore: join(data_dir, 'datastore'),
    identity: join(data_dir, 'identity.key'),
    libraries: join(data_dir, 'libraries.json')
});
