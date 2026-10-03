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
export const resolve_peer_config = (config = {}) => {
    const resolved = { ...DEFAULT_PEER_CONFIG, ...config };
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
