// Local file ingest (§6.4.1). Step numbers below are the spec's.
//
// The pipeline runs in two phases so a node can work on several files at
// once. prepare_local_file does everything that depends on the file alone:
// fingerprint, metadata, decode, tag strip, and the blob imports and pins.
// commit_local_file then makes step 3's decision against the library as it
// is at that moment, and appends; a caller serialises commits per library.
// A commit that refuses, or finds the track already there, releases the
// blobs its prepare pinned.
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { compute_track_id } from '#entry/id.ts';
import { IngestError } from '#types/ingest.ts';
import { upload_artwork } from "./artwork.js";
import { decoded_duration } from "./duration.js";
import { compute_fingerprint, is_degenerate_fingerprint } from "./fingerprint.js";
import { extract_metadata } from "./metadata.js";
import { find_existing_track, put_track, stored_track_duration } from "./put-track.js";
import { strip_tags } from "./tag-strip.js";
// Durations within this many seconds count as one recording (§6.4.1 step 3).
export const COLLISION_TOLERANCE_SECONDS = 30;
// Step 3: the library's live entry for the id, or undefined. A stored
// duration more than 30 s from the file's refuses the ingest as a collision.
const existing_entry = async ({ target, track_id, file_path, duration }) => {
    const existing = find_existing_track({ oplog: target.oplog, track_id });
    if (existing === undefined)
        return undefined;
    const stored = await stored_track_duration({ content_store: target.content_store, content_cid: existing.content_cid });
    if (stored === undefined)
        return existing;
    const decoded = await duration();
    if (Math.abs(decoded - stored) > COLLISION_TOLERANCE_SECONDS) {
        throw new IngestError('track_id_collision', `${file_path} (${decoded.toFixed(1)} s) shares track id ${track_id} with entry ${existing.entry_hash} (${stored} s)`);
    }
    return existing;
};
export const prepare_local_file = async ({ file_path, target, toolchain, resolver = [] }) => {
    const { content_store } = target;
    // 1-2: fingerprint the original file, never the stripped copy, and refuse
    // a degenerate one, which silence or a steady tone yields (§6.1.6).
    const fingerprint = await compute_fingerprint({ file_path, toolchain });
    if (is_degenerate_fingerprint(fingerprint)) {
        throw new IngestError('degenerate_fingerprint', `${file_path} fingerprints to a degenerate value, as a silent or steady-tone opening does`);
    }
    const track_id = compute_track_id(fingerprint);
    let decoded;
    const duration = async () => await (decoded ??= decoded_duration({ file_path, toolchain }));
    // 3, early: a repeat skips the rest of the work. The commit decides again.
    const existing = await existing_entry({ target, track_id, file_path, duration });
    if (existing !== undefined)
        return { kind: 'existing', track: existing };
    // 4-5: metadata, with artwork split out, and the decoded duration stored
    // in place of the container's.
    const metadata = await extract_metadata({ file_path, fingerprint });
    const { tags: content_tags, pictures } = metadata;
    const audio = { ...metadata.audio, duration: await duration() };
    // The stripped copy keeps the source extension, which selects the container.
    const extension = extname(file_path);
    if (extension === '')
        throw new IngestError('tool_failed', `${file_path} has no file extension to select the output container`);
    const temp_dir = await mkdtemp(join(tmpdir(), 'record-ingest-'));
    try {
        // 6-7: strip tags into the temp dir and import the result.
        const stripped_path = join(temp_dir, `stripped${extension}`);
        await strip_tags({ input_path: file_path, output_path: stripped_path, toolchain });
        const audio_cid = await content_store.import_blob(stripped_path);
        // 8: artwork, in source order.
        const artwork = await upload_artwork({ pictures, content_store });
        // 9-10: measure the blob and assemble track.content.
        const { size } = await stat(stripped_path);
        const content = { hash: audio_cid, size, tags: content_tags, audio, artwork, resolver: [...resolver] };
        // 11: the audio blob and artwork are UnixFS DAGs, so pinned recursively.
        const blobs = [audio_cid, ...artwork];
        for (const cid of blobs)
            await content_store.pin(cid, { recursive: true });
        return { kind: 'new', file_path, track_id, duration: audio.duration, content, blobs };
    }
    finally {
        // 14: remove the temporary tag-stripped file.
        await rm(temp_dir, { recursive: true, force: true });
    }
};
export const commit_local_file = async ({ prepared, target, release, tags, timestamp }) => {
    if (prepared.kind === 'existing')
        return prepared.track;
    try {
        // 3, authoritative: another commit may have added the id since the prepare.
        const existing = await existing_entry({ target, track_id: prepared.track_id, file_path: prepared.file_path, duration: async () => prepared.duration });
        if (existing !== undefined) {
            await release(prepared.blobs);
            return existing;
        }
        // 12-13: envelope, PUT, sign, append, and pin.
        return await put_track({ target, content: prepared.content, tags, timestamp });
    }
    catch (error) {
        await release(prepared.blobs);
        throw error;
    }
};
export const prepared_blobs = (prepared) => prepared.kind === 'new' ? prepared.blobs : [];
// Both phases back to back, for a caller with one file and nothing to overlap.
export const ingest_local_file = async ({ file_path, target, toolchain, resolver, tags, timestamp, release }) => {
    const prepared = await prepare_local_file({ file_path, target, toolchain, ...(resolver === undefined ? {} : { resolver }) });
    return await commit_local_file({ prepared, target, release: release ?? (async () => { }), tags, timestamp });
};
