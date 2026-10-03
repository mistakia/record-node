// Local file ingest (§6.4.1). Step numbers below are the spec's.
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { compute_track_id } from '#entry/id.ts';
import { IngestError } from '#types/ingest.ts';
import { upload_artwork } from "./artwork.js";
import { compute_fingerprint } from "./fingerprint.js";
import { extract_metadata } from "./metadata.js";
import { find_existing_track, put_track } from "./put-track.js";
import { strip_tags } from "./tag-strip.js";
export const ingest_local_file = async ({ file_path, target, toolchain, resolver = [], tags, timestamp }) => {
    const { content_store } = target;
    // 1-2: fingerprint the original file, never the stripped copy.
    const fingerprint = await compute_fingerprint({ file_path, toolchain });
    const track_id = compute_track_id(fingerprint);
    // 3: an existing live entry wins.
    const existing = find_existing_track({ oplog: target.oplog, track_id });
    if (existing !== undefined)
        return existing;
    // 4-5: metadata, with artwork split out.
    const { tags: content_tags, audio, pictures } = await extract_metadata({ file_path, fingerprint });
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
        for (const cid of [audio_cid, ...artwork])
            await content_store.pin(cid, { recursive: true });
        // 12-13: envelope, PUT, sign, append, and pin.
        return await put_track({ target, content, tags, timestamp });
    }
    finally {
        // 14: remove the temporary tag-stripped file.
        await rm(temp_dir, { recursive: true, force: true });
    }
};
