// Peer configuration: tool paths and pins, protocol tuning floors, and the
// data directory. Every field has a default, so {} is a valid configuration.
import { join } from 'node:path';
import { DEFAULT_NETWORK_CONFIG } from '#adapter/libp2p/config.ts';
import { PINNED_FFMPEG_VERSION, PINNED_FPCALC_VERSION } from '#ingest/toolchain.ts';
// The protocol-bound tool pins (§6.1.5, §6.2.4). The ffmpeg flags and the
// fpcalc algorithm are fixed in src/ingest, not configurable.
export const TOOL_PINS = Object.freeze({
    ffmpeg_version: PINNED_FFMPEG_VERSION,
    fpcalc_version: PINNED_FPCALC_VERSION,
    fpcalc_algorithm: 2
});
export const HEADS_INTERVAL_FLOOR_MS = 1000;
export const ANNOUNCE_INTERVAL_FLOOR_MS = 5000;
export const DEFAULT_PEER_CONFIG = Object.freeze({
    ffmpeg_path: 'ffmpeg',
    fpcalc_path: 'fpcalc',
    allow_toolchain_mismatch: false,
    ingest_prepare_concurrency: 8,
    traversal_concurrency: 4,
    traversal_timeout_ms: 30_000,
    audio_fetch_timeout_ms: 30_000,
    audio_cache_max_bytes: 512 * 1024 * 1024,
    blob_fetch_timeout_ms: 10 * 60_000,
    heads_interval_ms: HEADS_INTERVAL_FLOOR_MS,
    announce_interval_ms: ANNOUNCE_INTERVAL_FLOOR_MS,
    network: DEFAULT_NETWORK_CONFIG
});
const STRING_FIELDS = ['ffmpeg_path', 'fpcalc_path'];
const OPTIONAL_STRING_FIELDS = ['data_dir', 'ytdlp_path'];
const is_string_list = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
// A partial network object fills in from the defaults.
const resolve_network_config = (network) => {
    if (network === false)
        return false;
    if (network === null || typeof network !== 'object' || Array.isArray(network))
        throw new TypeError('network must be false or an object');
    const resolved = { ...DEFAULT_NETWORK_CONFIG, ...network };
    const unknown = Object.keys(resolved).filter((key) => !(key in DEFAULT_NETWORK_CONFIG));
    if (unknown.length > 0)
        throw new TypeError(`network has unknown keys: ${unknown.join(', ')}`);
    for (const field of ['listen', 'bootstrap']) {
        if (!is_string_list(resolved[field]))
            throw new TypeError(`network.${field} must be an array of multiaddr strings`);
    }
    for (const field of ['mdns', 'dht']) {
        if (typeof resolved[field] !== 'boolean')
            throw new TypeError(`network.${field} must be true or false`);
    }
    return Object.freeze(resolved);
};
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
    for (const field of ['ingest_prepare_concurrency', 'traversal_concurrency', 'traversal_timeout_ms', 'audio_fetch_timeout_ms', 'audio_cache_max_bytes', 'blob_fetch_timeout_ms', 'heads_interval_ms', 'announce_interval_ms']) {
        if (!Number.isSafeInteger(resolved[field]) || resolved[field] <= 0) {
            throw new RangeError(`${field} must be a positive integer, not ${String(resolved[field])}`);
        }
    }
    if (resolved.heads_interval_ms < HEADS_INTERVAL_FLOOR_MS)
        throw new RangeError(`heads_interval_ms must be at least ${HEADS_INTERVAL_FLOOR_MS}`);
    if (resolved.announce_interval_ms < ANNOUNCE_INTERVAL_FLOOR_MS)
        throw new RangeError(`announce_interval_ms must be at least ${ANNOUNCE_INTERVAL_FLOOR_MS}`);
    return Object.freeze({ ...resolved, network: resolve_network_config(resolved.network) });
};
// The data directory layout.
export const data_paths = (data_dir) => ({
    blocks: join(data_dir, 'blocks'),
    datastore: join(data_dir, 'datastore'),
    identity: join(data_dir, 'identity.key'),
    libraries: join(data_dir, 'libraries.json'),
    // The persisted query index (§4.7): reopened across restarts so the library
    // is not re-projected from blocks every time.
    index: join(data_dir, 'index.sqlite')
});
