// Envelope payload objects, the dag-cbor blocks behind envelope.content
// (§2.4, §2.5, §2.6, §2.8.3).
import { decode_canonical } from '#encoding/canonical-bytes.ts';
import { is_cid_string } from '#encoding/cid.ts';
import { is_library_address } from '#encoding/library-address.ts';
import { assert_payload_size } from '#encoding/size-bounds.ts';
import { ProtocolError } from '#types/errors.ts';
import { is_record } from '#types/guards.ts';
const invalid = (message) => new ProtocolError('invalid_shape', message);
// Size before decode, then canonical form (§2.1, §2.8.3).
export const decode_payload = (bytes) => {
    assert_payload_size(bytes);
    return decode_canonical(bytes).value;
};
// (extractor, id) is the identity of a source pointer (§2.4.2).
export const resolver_key = ({ extractor, id }) => JSON.stringify([extractor, id]);
const validate_resolver_entry = (value) => {
    if (!is_record(value))
        throw invalid('a resolver entry must be a map');
    if (typeof value.extractor !== 'string' || typeof value.id !== 'string') {
        throw invalid('a resolver entry requires string extractor and id');
    }
    // A streaming url decays and leaks the ingest path, so it is never persisted
    // and a received entry carrying one is rejected (§2.4.2).
    if ('url' in value)
        throw invalid('a resolver entry must not carry a streaming url');
    return { extractor: value.extractor, id: value.id };
};
export const validate_resolver_entries = (value) => {
    if (!Array.isArray(value))
        throw invalid('track content resolver must be an array');
    const seen = new Set();
    for (const element of value) {
        const key = resolver_key(validate_resolver_entry(element));
        if (seen.has(key))
            throw invalid(`resolver entries repeat the source pointer ${key}`);
        seen.add(key);
    }
};
// The §2.4.1 required fields. Optional tags and audio fields pass through.
export const validate_track_content = (value) => {
    if (!is_record(value))
        throw invalid('track content must be a map');
    if (!is_cid_string(value.hash))
        throw invalid('track content hash must be a CID');
    if (!Number.isSafeInteger(value.size) || value.size < 0)
        throw invalid('track content size must be an unsigned integer');
    if (!is_record(value.tags))
        throw invalid('track content tags must be a map');
    const fingerprint = value.tags.acoustid_fingerprint;
    if (typeof fingerprint !== 'string' || fingerprint.length === 0)
        throw invalid('track content requires tags.acoustid_fingerprint');
    if (!is_record(value.audio))
        throw invalid('track content audio must be a map');
    if (!Array.isArray(value.artwork) || !value.artwork.every(is_cid_string))
        throw invalid('track content artwork must be an array of CIDs');
    validate_resolver_entries(value.resolver);
    return value;
};
export const validate_log_content = (value) => {
    if (!is_record(value))
        throw invalid('log content must be a map');
    if (!is_library_address(value.address))
        throw invalid('log content address must be a library address');
    if (value.alias !== undefined && value.alias !== null && typeof value.alias !== 'string')
        throw invalid('log alias must be a string or null');
    return value;
};
// about.address is the owning library's own address, and an avatar is a CID,
// never a URL (§2.6).
export const validate_about_content = ({ value, library_address }) => {
    if (!is_record(value))
        throw invalid('about content must be a map');
    if (value.address !== library_address)
        throw invalid('about content address must equal the owning library address');
    if (value.avatar !== undefined && value.avatar !== null && !is_cid_string(value.avatar)) {
        throw invalid('about avatar must be a content-addressed CID, not a URL');
    }
    return value;
};
