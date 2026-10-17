// Metadata extraction through music-metadata (§6.3, §6.4.1 steps 4-5).
//
// Only the fields §2.4.1 and §6.3 enumerate are persisted. Passthrough of
// other library fields is permitted (MAY) but left out: it would tie the
// dag-cbor content, and so the content CID, to one library's output.
import { parseFile } from 'music-metadata';
import { IngestError } from '#types/ingest.ts';
const is_present = (value) => value !== undefined && value !== null && !(typeof value === 'number' && !Number.isFinite(value));
// Drops absent fields: unknown is omission, never 0 (§6.3.2).
const present_fields = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => is_present(value)));
const positive = (value) => value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
const positive_integer = (value) => {
    const finite = positive(value);
    return finite === undefined ? undefined : Math.round(finite);
};
// §2.4.1 types remixer as a string; music-metadata yields a list.
const joined = (values) => values === undefined || values.length === 0 ? undefined : values.join(', ');
const without_undefined = (value) => JSON.parse(JSON.stringify(value));
const map_tags = ({ common, fingerprint }) => present_fields({
    acoustid_fingerprint: fingerprint,
    title: common.title,
    artist: common.artist,
    artists: common.artists,
    albumartist: common.albumartist,
    album: common.album,
    remixer: joined(common.remixer),
    bpm: positive(common.bpm),
    genre: common.genre,
    track: common.track,
    disk: common.disk
});
const map_audio = (format) => present_fields({
    bitrate: positive_integer(format.bitrate),
    codec: format.codec,
    container: format.container,
    sampleRate: positive_integer(format.sampleRate),
    numberOfChannels: positive_integer(format.numberOfChannels),
    numberOfSamples: format.numberOfSamples,
    lossless: format.lossless,
    codecProfile: format.codecProfile,
    tagTypes: format.tagTypes,
    trackInfo: format.trackInfo === undefined ? undefined : format.trackInfo.map(without_undefined)
});
// The fingerprint becomes tags.acoustid_fingerprint (§6.3.1). The duration
// written is the decoded one (duration.ts), never the container's.
export const extract_metadata = async ({ file_path, fingerprint }) => {
    let metadata;
    try {
        metadata = await parseFile(file_path, { duration: true });
    }
    catch (error) {
        throw new IngestError('no_audio', `cannot read audio metadata from ${file_path}: ${error.message}`);
    }
    const { common, format } = metadata;
    const pictures = (common.picture ?? []).map(({ format: picture_format, data }) => ({ format: picture_format, data }));
    return { tags: map_tags({ common, fingerprint }), audio: map_audio(format), pictures };
};
const resolver_text = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
// `Artist - Title`, the convention of most uploaded music titles.
const ARTIST_TITLE = /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/;
// The title and artist a resolver record names. A record's artist is often
// the uploader's channel, so an `Artist - Title` full title outranks it.
const resolver_title_artist = (source) => {
    const artist = resolver_text(source['artist']);
    const alt_title = resolver_text(source['alt_title']);
    if (alt_title !== undefined)
        return { title: alt_title, ...(artist === undefined ? {} : { artist }) };
    const full_title = resolver_text(source['fulltitle']);
    const split = full_title === undefined ? null : ARTIST_TITLE.exec(full_title);
    if (split !== null)
        return { artist: split[1].trim(), title: split[2].trim() };
    return { ...(full_title === undefined ? {} : { title: full_title }), ...(artist === undefined ? {} : { artist }) };
};
// §6.4.2 step 4: a downloaded stream often carries no tags, so the first
// resolver record fills a missing title and artist. The file's tags win.
export const with_resolver_tags = (tags, resolver) => {
    const [source] = resolver;
    if (source === undefined)
        return tags;
    const { title, artist } = resolver_title_artist(source);
    return {
        ...tags,
        ...(tags['title'] === undefined && title !== undefined ? { title } : {}),
        ...(tags['artist'] === undefined && artist !== undefined ? { artist } : {})
    };
};
