// URL ingest (§6.4.2). Step 1, resolution, is the caller's: a URL can name
// several sources, and the import reports progress per source. Each resolved
// record then runs steps 2-4 here.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { to_resolver_entry } from 'record-resolver';
import { commit_local_file, prepare_local_file, prepared_blobs } from "./pipeline-local.js";
import { add_track_resolver } from "./put-track.js";
// yt-dlp names the container in ext; the stripped copy keeps it (§6.4.1 step 6).
const extension_of = ({ ext, url }) => {
    if (typeof ext === 'string' && /^[0-9a-z]+$/i.test(ext))
        return `.${ext}`;
    return extname(new URL(url).pathname);
};
// Steps 2-4 up to the commit: the cache check, the download, and the local
// prepare, all of which run outside the library's commit order.
export const prepare_resolved_entry = async ({ entry, target, toolchain, find_by_source, download }) => {
    // Step 4's strip happens first, so nothing downstream ever holds the
    // streaming url, ext, or request headers (§2.4.2).
    const resolver = to_resolver_entry(entry);
    // Step 2: an already-ingested source returns its track without a download.
    const existing = find_by_source(resolver);
    if (existing !== undefined)
        return { kind: 'cached', track: existing };
    const temp_dir = await mkdtemp(join(tmpdir(), 'record-download-'));
    try {
        // Step 3: the audio stream to a temporary file.
        const file_path = join(temp_dir, `download${extension_of(entry)}`);
        await download({ url: entry.url, headers: entry.http_headers, output_path: file_path });
        // Step 4: the local pipeline, with the stripped record attached.
        const prepared = await prepare_local_file({ file_path, target, toolchain, resolver: [{ ...resolver }] });
        return { kind: 'downloaded', resolver, prepared };
    }
    finally {
        await rm(temp_dir, { recursive: true, force: true });
    }
};
export const commit_resolved_entry = async ({ source, target, release, tags, timestamp }) => {
    if (source.kind === 'cached')
        return source.track;
    const track = await commit_local_file({ prepared: source.prepared, target, release, tags, timestamp });
    // Audio the library already held keeps its entry, so the source is added
    // to it: the next request for this source then dedups at step 2 (§2.10).
    if (!track.existing)
        return track;
    return await add_track_resolver({ target, track_id: track.track_id, resolver: source.resolver }) ?? track;
};
export const source_blobs = (source) => source.kind === 'downloaded' ? prepared_blobs(source.prepared) : [];
// Both phases back to back.
export const ingest_resolved_entry = async ({ entry, target, toolchain, find_by_source, download, tags, timestamp, release = async () => { } }) => {
    const source = await prepare_resolved_entry({ entry, target, toolchain, find_by_source, download });
    return await commit_resolved_entry({ source, target, release, tags, timestamp });
};
